"""Authoritative Railway Domain Ontology Engine.

Loads declarative classification rules from railway_ontology.yaml and executes
multi-tiered classification against AutoCAD entities with zero hardcoded if/elif chains.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

log = logging.getLogger("cad.ontology")

_DEFAULT_ONTOLOGY_PATH = Path(__file__).parent / "railway_ontology.yaml"


def clean_attribute_tag(tag: str) -> str:
    """Normalizes CAD attribute tags: removes punctuation, whitespace, and case-folds."""
    if not tag:
        return ""
    return re.sub(r"[\s\.\:\-_]+", "_", tag.strip().upper()).strip("_")


@dataclass
class CategoryRule:
    category_id: int
    category_key: str
    priority: int
    attribute_tags: list[str]
    name_keywords: list[str]
    layer_keywords: list[str]
    text_patterns: list[re.Pattern]
    direction_values: set[str] = field(default_factory=set)


@dataclass
class OntologyClassification:
    category_key: str
    category_id: int
    confidence: float
    matched_rule: str
    resolved_name: str


class RailwayOntology:
    """Singleton/loader for the Railway Domain Ontology."""

    _instance: RailwayOntology | None = None

    def __init__(self, yaml_path: Path | None = None) -> None:
        self.yaml_path = yaml_path or _DEFAULT_ONTOLOGY_PATH
        self.version: str = "1.0.0"
        self.categories: list[dict[str, Any]] = []
        self.rules: list[CategoryRule] = []
        self._load()

    def _load(self) -> None:
        if not self.yaml_path.exists():
            log.warning("Ontology file not found at %s, using empty configuration", self.yaml_path)
            return

        with open(self.yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        self.version = data.get("version", "1.0.0")
        cats_raw = data.get("categories", [])
        self.categories = []
        self.rules = []

        for c in cats_raw:
            cid = int(c.get("id", 0))
            ckey = str(c.get("key", "other"))
            cname = str(c.get("name", ckey.title()))
            cicon = str(c.get("icon", "circle"))
            cdesc = str(c.get("description", ""))
            color = str(c.get("color", "#FFFFFF"))

            self.categories.append({
                "id": cid,
                "key": ckey,
                "name": cname,
                "icon": cicon,
                "description": cdesc,
                "color": color,
            })

            r_raw = c.get("rules", {})
            attr_tags = [clean_attribute_tag(t) for t in r_raw.get("attribute_tags", [])]
            name_kw = [k.lower() for k in r_raw.get("name_keywords", [])]
            layer_kw = [k.lower() for k in r_raw.get("layer_keywords", [])]
            raw_patterns = r_raw.get("text_patterns", [])
            compiled_patterns = []
            for pat in raw_patterns:
                try:
                    compiled_patterns.append(re.compile(pat, re.IGNORECASE))
                except re.error as exc:
                    log.warning("Invalid regex in ontology pattern %s: %s", pat, exc)

            dir_vals = {v.upper() for v in r_raw.get("direction_values", [])}
            priority = int(c.get("priority", 100))

            self.rules.append(CategoryRule(
                category_id=cid,
                category_key=ckey,
                priority=priority,
                attribute_tags=attr_tags,
                name_keywords=name_kw,
                layer_keywords=layer_kw,
                text_patterns=compiled_patterns,
                direction_values=dir_vals,
            ))

        self.rules.sort(key=lambda r: r.priority)
        self.categories.sort(key=lambda c: c["id"])

    @classmethod
    def get_instance(cls) -> RailwayOntology:
        if cls._instance is None:
            cls._instance = RailwayOntology()
        return cls._instance

    @classmethod
    def reload(cls, path: Path | None = None) -> RailwayOntology:
        cls._instance = RailwayOntology(path)
        return cls._instance

    def get_category_config(self) -> list[dict[str, Any]]:
        return self.categories

    def classify(
        self,
        name: str = "",
        tags: dict[str, str] | None = None,
        layer: str = "",
        text: str = "",
        dxftype: str = "",
    ) -> OntologyClassification:
        """Evaluates CAD entity against declarative ontology rules."""
        tags = tags or {}
        norm_tags = {clean_attribute_tag(k) for k in tags.keys()}
        name_low = name.lower()
        layer_low = layer.lower()
        text_clean = text.strip()

        # Tier 1: Match by declared attribute tags (highest confidence)
        for rule in self.rules:
            for tag in rule.attribute_tags:
                if tag in norm_tags:
                    return OntologyClassification(
                        category_key=rule.category_key,
                        category_id=rule.category_id,
                        confidence=0.95,
                        matched_rule=f"attribute_tag:{tag}",
                        resolved_name=name or text_clean,
                    )

        # Tier 2: Match by block name keywords
        if name_low:
            for rule in self.rules:
                for kw in rule.name_keywords:
                    if kw in name_low:
                        return OntologyClassification(
                            category_key=rule.category_key,
                            category_id=rule.category_id,
                            confidence=0.85,
                            matched_rule=f"name_keyword:{kw}",
                            resolved_name=name or text_clean,
                        )

        # Tier 3: Match by text regex patterns
        if text_clean:
            for rule in self.rules:
                for pat in rule.text_patterns:
                    if pat.match(text_clean):
                        # Text annotations often belong to templates unless representing functional labels
                        is_label_cat = rule.category_key in ("rfid_tags", "signals", "points", "axle_counters", "shunts")
                        if dxftype in ("TEXT", "MTEXT") and not is_label_cat:
                            return OntologyClassification(
                                category_key="templates",
                                category_id=8,
                                confidence=0.75,
                                matched_rule=f"text_annotation:{pat.pattern}",
                                resolved_name=f"Annotation ({text_clean})",
                            )
                        return OntologyClassification(
                            category_key=rule.category_key,
                            category_id=rule.category_id,
                            confidence=0.80,
                            matched_rule=f"text_pattern:{pat.pattern}",
                            resolved_name=name or text_clean,
                        )

        # Tier 4: Match by layer keywords
        if layer_low:
            for rule in self.rules:
                for kw in rule.layer_keywords:
                    if kw in layer_low:
                        return OntologyClassification(
                            category_key=rule.category_key,
                            category_id=rule.category_id,
                            confidence=0.60,
                            matched_rule=f"layer_keyword:{kw}",
                            resolved_name=name or text_clean,
                        )

        # Default fallback
        return OntologyClassification(
            category_key="other",
            category_id=0,
            confidence=0.10,
            matched_rule="default",
            resolved_name=name or text_clean,
        )

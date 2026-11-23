"""Unit tests for declarative Railway Domain Ontology."""
import pytest
from app.ontology.ontology_engine import RailwayOntology, clean_attribute_tag


def test_ontology_loads_categories():
    ont = RailwayOntology()
    cats = ont.get_category_config()
    assert len(cats) >= 8
    cat_keys = [c["key"] for c in cats]
    assert "signals" in cat_keys
    assert "tracks_tins" in cat_keys
    assert "rfid_tags" in cat_keys
    assert "axle_counters" in cat_keys
    assert "shunts" in cat_keys
    assert "points" in cat_keys
    assert "gates" in cat_keys
    assert "templates" in cat_keys


def test_classification_by_attribute_tag():
    ont = RailwayOntology()
    
    # RFID tag
    res_rfid = ont.classify(tags={"RFID_TAG_NO.": "R-166"})
    assert res_rfid.category_key == "rfid_tags"
    assert res_rfid.category_id == 3
    assert res_rfid.confidence >= 0.9
    
    # Signal tag
    res_sig = ont.classify(tags={"SIGNAL_NO": "S101"})
    assert res_sig.category_key == "signals"
    assert res_sig.category_id == 1
    
    # Point machine tag
    res_pt = ont.classify(tags={"A_END_POINT_NO.": "P12A"})
    assert res_pt.category_key == "points"
    assert res_pt.category_id == 6
    
    # Axle counter DP tag
    res_dp = ont.classify(tags={"DP_NO": "DP7B"})
    assert res_dp.category_key == "axle_counters"
    assert res_dp.category_id == 4


def test_classification_by_name_and_layer_keywords():
    ont = RailwayOntology()
    
    # By block name
    res_shunt = ont.classify(name="SHUNT_SIGNAL_TYPE_A")
    assert res_shunt.category_key == "shunts"
    assert res_shunt.category_id == 5
    
    res_gate = ont.classify(name="LC_GATE_BARRIER")
    assert res_gate.category_key == "gates"
    assert res_gate.category_id == 7

    # By layer name
    res_layer_sig = ont.classify(layer="6. Nom. Sig.")
    assert res_layer_sig.category_key == "signals"


def test_classification_by_regex_patterns():
    ont = RailwayOntology()
    
    # Tag number pattern
    res_tag = ont.classify(text="R-247")
    assert res_tag.category_key == "rfid_tags"
    
    # Axle counter DP pattern
    res_dp = ont.classify(text="DP12A")
    assert res_dp.category_key == "axle_counters"
    
    # Shunt pattern
    res_sh = ont.classify(text="01HS")
    assert res_sh.category_key == "shunts"


def test_clean_attribute_tag():
    assert clean_attribute_tag("RFID_TAG_NO.") == "RFID_TAG_NO"
    assert clean_attribute_tag(" A_End_Point_No: ") == "A_END_POINT_NO"
    assert clean_attribute_tag("") == ""


"""Reference decoder for the .cadr format (used by tests and docs)."""
import gzip, json, struct
import numpy as np


def decode(data: bytes):
    assert data[:4] == b"CADR"
    ver, jl = struct.unpack_from("<II", data, 4)
    head = json.loads(data[12:12 + jl])
    off = 12 + jl
    meta = np.frombuffer(data, "<u4", head["paths"] * 5, off).reshape(-1, 5)
    off += meta.nbytes
    verts = np.frombuffer(data, "<f4", head["vertices"] * 2, off).reshape(-1, 2)
    return head, meta, verts


def load(path):
    return decode(gzip.decompress(open(path, "rb").read()))

#!/usr/bin/env python3
"""只读 GGUF 头部元数据，不需要任何依赖。用法: python gguf_meta.py <file.gguf>"""
import struct
import sys

T_U8, T_I8, T_U16, T_I16, T_U32, T_I32, T_F32, T_BOOL, T_STR, T_ARR, T_U64, T_I64, T_F64 = range(13)
SCALAR = {
    T_U8: ("<B", 1), T_I8: ("<b", 1), T_U16: ("<H", 2), T_I16: ("<h", 2),
    T_U32: ("<I", 4), T_I32: ("<i", 4), T_F32: ("<f", 4), T_BOOL: ("<?", 1),
    T_U64: ("<Q", 8), T_I64: ("<q", 8), T_F64: ("<d", 8),
}


def read_string(f):
    n = struct.unpack("<Q", f.read(8))[0]
    return f.read(n).decode("utf-8", "replace")


def read_value(f, vtype):
    if vtype == T_STR:
        return read_string(f)
    if vtype == T_ARR:
        etype = struct.unpack("<I", f.read(4))[0]
        count = struct.unpack("<Q", f.read(8))[0]
        if etype == T_STR:
            return [read_string(f) for _ in range(count)]
        fmt, size = SCALAR[etype]
        return list(struct.unpack("<" + fmt[-1] * count, f.read(size * count)))
    fmt, size = SCALAR[vtype]
    return struct.unpack(fmt, f.read(size))[0]


def main(path):
    with open(path, "rb") as f:
        magic = f.read(4)
        if magic != b"GGUF":
            print(f"{path}: 不是 GGUF（magic={magic!r}）")
            return
        version = struct.unpack("<I", f.read(4))[0]
        n_tensors = struct.unpack("<Q", f.read(8))[0]
        n_kv = struct.unpack("<Q", f.read(8))[0]
        meta = {}
        for _ in range(n_kv):
            key = read_string(f)
            vtype = struct.unpack("<I", f.read(4))[0]
            try:
                meta[key] = read_value(f, vtype)
            except Exception as e:
                print(f"解析 {key} 失败: {e}")
                break

    print(f"\n=== {path.split('/')[-1]} ===")
    print(f"GGUF v{version}  张量 {n_tensors} 个  元数据 {n_kv} 条")
    want = [
        "general.architecture", "general.name", "general.file_type",
        "general.quantization_version",
    ]
    arch = meta.get("general.architecture", "?")
    want += [
        f"{arch}.block_count", f"{arch}.embedding_length", f"{arch}.feed_forward_length",
        f"{arch}.attention.head_count", f"{arch}.attention.head_count_kv",
        f"{arch}.context_length", f"{arch}.rope.freq_base",
    ]
    for k in want:
        if k in meta:
            v = meta[k]
            if isinstance(v, list) and len(v) > 8:
                v = f"[{len(v)} 项]"
            print(f"  {k:48s} = {v}")
    ft = meta.get("general.file_type")
    if isinstance(ft, int):
        known = {0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 7: "Q8_0", 8: "Q5_0", 9: "Q5_1",
                 10: "Q2_K", 11: "Q3_K_S", 12: "Q3_K_M", 13: "Q3_K_L", 14: "Q4_K_S",
                 15: "Q4_K_M", 16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K", 30: "BF16"}
        print(f"  → file_type {ft}" + (f"（{known[ft]}）" if ft in known else "（非标准/自定义量化）"))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p)

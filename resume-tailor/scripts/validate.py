#!/usr/bin/env python3
"""
resume-tailor/scripts/validate.py

Local recreation of the docx-skill validation contract (scripts/office/validate.py
is not available on this machine). Checks an EDITED .docx against the ORIGINAL
template it was derived from:

  1. Every XML part in both zips is well-formed (parses without error).
  2. The edited file has the same part list as the original.
  3. word/document.xml differs ONLY inside the placeholder region: everything
     before and after it must be byte-identical to the original.

Usage:
  python scripts/validate.py --original <template.docx> <edited.docx>

Exit codes: 0 = clean, non-zero = structural problems found (never "probably fine").
"""

import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def fail(msg: str) -> None:
    print(f"VALIDATION ERROR: {msg}")
    sys.exit(1)


def load_parts(path: str) -> dict[str, bytes]:
    parts: dict[str, bytes] = {}
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            parts[name] = zf.read(name)
    return parts


def check_wellformed(path: str, parts: dict[str, bytes]) -> None:
    for name, data in parts.items():
        if name.endswith(".xml") or name.endswith(".rels"):
            try:
                ET.fromstring(data)
            except ET.ParseError as e:
                fail(f"{path}: {name} is not well-formed XML: {e}")


def main() -> None:
    args = sys.argv[1:]
    if len(args) != 3 or args[0] != "--original":
        print("Usage: python scripts/validate.py --original <template.docx> <edited.docx>")
        sys.exit(1)

    original_path, edited_path = args[1], args[2]

    original = load_parts(original_path)
    edited = load_parts(edited_path)
    check_wellformed(original_path, original)
    check_wellformed(edited_path, edited)
    print(f"[ok] all XML parts well-formed in both files ({len(edited)} parts)")

    # Part-list parity
    missing = set(original.keys()) - set(edited.keys())
    extra = set(edited.keys()) - set(original.keys())
    if missing:
        fail(f"edited docx is missing parts present in original: {sorted(missing)}")
    if extra:
        fail(f"edited docx has unexpected extra parts: {sorted(extra)}")

    # document.xml: only the placeholder region may differ
    orig_doc = original.get("word/document.xml", b"").decode("utf-8")
    edit_doc = edited.get("word/document.xml", b"").decode("utf-8")
    if orig_doc == edit_doc:
        # No change at all is suspicious but not structurally broken; report loudly.
        print("[warn] word/document.xml is IDENTICAL to the original - nothing was replaced?")
        return

    para_re = re.compile(r"<w:p\b[^>]*>[\s\S]*?</w:p>")
    paras = list(para_re.finditer(orig_doc))
    ph = next((m for m in paras if "{{PROJECTS_PLACEHOLDER}}" in m.group(0)), None)
    if ph is None:
        fail("could not locate {{PROJECTS_PLACEHOLDER}} paragraph in ORIGINAL template")

    before_orig = orig_doc[: ph.start()]
    after_orig = orig_doc[ph.end() :]
    if not edit_doc.startswith(before_orig):
        # Find first divergence point for a useful message
        i = next((k for k, (a, b) in enumerate(zip(edit_doc, before_orig)) if a != b), min(len(edit_doc), len(before_orig)))
        fail(
            f"edited document.xml diverges from the original BEFORE the replaced region "
            f"(first difference at char {i}) - something other than the placeholder was modified"
        )
    tail_start = len(edit_doc) - len(after_orig)
    if tail_start < len(before_orig) or edit_doc[tail_start:] != after_orig:
        fail("edited document.xml diverges from the original AFTER the replaced region")

    replaced_region = edit_doc[len(before_orig) : tail_start]
    n_paras = len(list(para_re.finditer(replaced_region)))
    print(
        f"[ok] word/document.xml changed ONLY inside the placeholder region "
        f"({len(replaced_region)} chars, {n_paras} paragraphs spliced)"
    )

    # Placeholder must be gone entirely
    if "{{PROJECTS_PLACEHOLDER}}" in edit_doc:
        fail("placeholder text still present somewhere in edited document.xml")
    print("[ok] no residual placeholder text")

    print("VALIDATION PASSED")


if __name__ == "__main__":
    main()

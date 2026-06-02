"""Unit tests for apply_citations covering the §11 edge cases (mirrors the JS
test-citation-apply.js)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from irg.citations.apply import apply_citations  # noqa: E402
from irg.citations.citation_id import derive_claim_uuid  # noqa: E402


def citable(handle, claim_key, **over):
    return {
        "handle": handle,
        "uuid": derive_claim_uuid(claim_key),
        "claim_key": claim_key,
        "claim_text": over.get("claim_text", f"claim {handle}"),
        "verdict": over.get("verdict", "supported"),
        "verification_level": over.get("verification_level", "verified"),
        "verification_confidence": over.get("verification_confidence", 0.8),
        "sources": over.get("sources", []),
    }


class TestApply(unittest.TestCase):
    def setUp(self):
        self.set = [citable("cit_1", "k1"), citable("cit_2", "k2")]

    def test_happy_path(self):
        r = apply_citations('Foo <citation ref="cit_1">bar</citation> baz.', self.set)
        self.assertEqual(len(r["references"]), 1)
        self.assertEqual(r["references"][0]["seq"], 1)
        self.assertIn(f'ref="{self.set[0]["uuid"]}"', r["prose"])
        self.assertIn('seq="1"', r["prose"])
        self.assertTrue(r["prose"].startswith("Foo <citation") and r["prose"].endswith("</citation> baz."))

    def test_hallucinated_handle_stripped(self):
        r = apply_citations('A <citation ref="cit_9">claimy text</citation> B', self.set)
        self.assertEqual(r["references"], [])
        self.assertEqual(r["prose"], "A claimy text B")
        self.assertEqual(r["stats"]["refs_dropped"], 1)

    def test_unclosed_tag_stripped(self):
        r = apply_citations('X <citation ref="cit_1">no close here and more', self.set)
        self.assertNotIn("<citation", r["prose"])
        self.assertIn("no close here and more", r["prose"])
        self.assertEqual(len(r["references"]), 0)

    def test_nested_inner_markup_stripped(self):
        r = apply_citations('<citation ref="cit_1">outer <citation ref="cit_2">inner</citation></citation>', self.set)
        self.assertEqual(len(r["references"]), 1)
        self.assertEqual(r["prose"].count("<citation"), 1)

    def test_no_citable_set_strips_all(self):
        r = apply_citations('Hello <citation ref="cit_1">world</citation>!', [])
        self.assertEqual(r["prose"], "Hello world!")
        self.assertEqual(r["references"], [])

    def test_same_claim_cited_twice_shares_seq(self):
        r = apply_citations('First <citation ref="cit_1">a</citation> then <citation ref="cit_1">b</citation>.', self.set)
        self.assertEqual(len(r["references"]), 1)
        self.assertEqual(r["prose"].count("<citation"), 2)
        self.assertEqual(r["prose"].count('seq="1"'), 2)

    def test_multisource_one_invalid_keeps_valid(self):
        r = apply_citations('<citation ref="cit_1 cit_99">multi</citation>', self.set)
        self.assertIn(f'ref="{self.set[0]["uuid"]}"', r["prose"])
        self.assertEqual(len(r["references"]), 1)
        self.assertEqual(r["stats"]["refs_dropped"], 1)

    def test_multisource_both_valid(self):
        r = apply_citations('<citation ref="cit_1 cit_2">both</citation>', self.set)
        self.assertIn(f'ref="{self.set[0]["uuid"]} {self.set[1]["uuid"]}"', r["prose"])
        self.assertIn('seq="1 2"', r["prose"])
        self.assertEqual(len(r["references"]), 2)

    def test_dense_renumber_by_appearance(self):
        s3 = [citable("cit_1", "k1"), citable("cit_2", "k2"), citable("cit_3", "k3")]
        r = apply_citations('<citation ref="cit_2">two</citation> <citation ref="cit_1">one</citation>', s3)
        by_key = {x["claim_key"]: x for x in r["references"]}
        self.assertEqual(by_key["k2"]["seq"], 1)
        self.assertEqual(by_key["k1"]["seq"], 2)

    def test_sentinel_chars_in_prose_do_not_corrupt(self):
        sent = chr(0xE000) + "0" + chr(0xE001)
        r = apply_citations(f'Pre {sent} mid <citation ref="cit_1">bar</citation> end', self.set)
        self.assertNotIn(chr(0xE000), r["prose"])
        self.assertIn(f'ref="{self.set[0]["uuid"]}"', r["prose"])
        self.assertTrue("Pre" in r["prose"] and "mid" in r["prose"] and "end" in r["prose"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

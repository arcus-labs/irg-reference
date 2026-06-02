"""Unit tests for build_citable_set (mirrors the JS test)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from irg.citations.build_citable_set import build_citable_set  # noqa: E402
from irg.citations.citation_id import derive_claim_uuid  # noqa: E402


class TestBuildCitableSet(unittest.TestCase):
    def test_fresh_verify_filters_and_maps(self):
        verify = {"results": [
            {"claim_key": "k1", "claim_text": "Saturn has rings.", "verdict": "supported",
             "verification_status": "verified_supported",
             "sources": [{"url": "https://nasa.gov", "extracted_title": "NASA",
                          "verification": {"quoted_excerpt": "rings exist"}}]},
            {"claim_key": "k2", "claim_text": "Maybe.", "verdict": "inconclusive",
             "verification_status": "verified_inconclusive", "sources": []},
            {"claim_key": "k3", "claim_text": "Myth is false.", "verdict": "refuted",
             "verification_status": "verified_refuted", "sources": []},
        ]}
        s = build_citable_set(citation_verify_result=verify)
        self.assertEqual(len(s), 2)  # supported + refuted, inconclusive excluded
        self.assertEqual(s[0]["handle"], "cit_1")
        self.assertEqual(s[1]["handle"], "cit_2")
        self.assertEqual(s[0]["uuid"], derive_claim_uuid("k1"))
        self.assertEqual(s[0]["sources"][0]["supporting_span"], "rings exist")
        self.assertEqual(s[0]["sources"][0]["title"], "NASA")

    def test_recalled_only_verified(self):
        recall = {"results": [
            {"claim_text": "Recalled fact.", "claim_key": "r1",
             "recall": {"hit": True, "verdict": "supported", "verification_level": "verified",
                        "verification_confidence": 0.9, "citation_path": "citations/2026-05/r1.json",
                        "sources": [{"url": "https://src", "title": "Src", "supporting_span": "s"}]}},
            {"claim_text": "Provisional.", "claim_key": "r2",
             "recall": {"hit": True, "verdict": "supported", "verification_level": "provisional"}},
            {"claim_text": "No hit.", "claim_key": "r3", "recall": {"hit": False}},
        ]}
        s = build_citable_set(memory_recall_result=recall)
        self.assertEqual(len(s), 1)
        self.assertEqual(s[0]["claim_key"], "r1")
        self.assertEqual(s[0]["citation_path"], "citations/2026-05/r1.json")

    def test_dedupe_fresh_wins(self):
        s = build_citable_set(
            citation_verify_result={"results": [{"claim_key": "dup", "claim_text": "Fresh.", "verdict": "supported", "verification_status": "verified_supported", "sources": []}]},
            memory_recall_result={"results": [{"claim_key": "dup", "claim_text": "Recalled.", "recall": {"hit": True, "verdict": "supported", "verification_level": "verified"}}]},
        )
        self.assertEqual(len(s), 1)
        self.assertEqual(s[0]["claim_text"], "Fresh.")

    def test_empty(self):
        self.assertEqual(build_citable_set(), [])
        self.assertEqual(build_citable_set(citation_verify_result={"results": []}), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)

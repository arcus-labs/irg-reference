"""Unit tests for compute_citation_quality (mirrors the JS test)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from irg.citations.quality_metrics import compute_citation_quality  # noqa: E402


class TestQualityMetrics(unittest.TestCase):
    def test_perfect(self):
        q = compute_citation_quality([
            {"claim_bearing": True, "has_citation": True, "citation_supports": True},
            {"claim_bearing": True, "has_citation": True, "citation_supports": True},
            {"claim_bearing": False, "has_citation": False, "citation_supports": False},
        ])
        self.assertEqual(q["citation_recall"], 1)
        self.assertEqual(q["citation_precision"], 1)
        self.assertEqual(q["citation_f1"], 1)
        self.assertEqual(q["counts"]["claim_bearing"], 2)
        self.assertEqual(q["counts"]["sentences"], 3)

    def test_recall_gap(self):
        q = compute_citation_quality([
            {"claim_bearing": True, "has_citation": True, "citation_supports": True},
            {"claim_bearing": True, "has_citation": False, "citation_supports": False},
        ])
        self.assertEqual(q["citation_recall"], 0.5)
        self.assertEqual(q["citation_precision"], 1)
        self.assertEqual(q["counts"]["uncited_claims"], 1)

    def test_precision_gap(self):
        q = compute_citation_quality([
            {"claim_bearing": True, "has_citation": True, "citation_supports": True},
            {"claim_bearing": True, "has_citation": True, "citation_supports": False},
        ])
        self.assertEqual(q["citation_precision"], 0.5)
        self.assertEqual(q["citation_recall"], 0.5)
        self.assertEqual(q["counts"]["misattributed_citations"], 1)

    def test_no_claims_null(self):
        q = compute_citation_quality([{"claim_bearing": False, "has_citation": False, "citation_supports": False}])
        self.assertIsNone(q["citation_recall"])
        self.assertIsNone(q["citation_precision"])
        self.assertIsNone(q["citation_f1"])

    def test_claims_no_citations(self):
        q = compute_citation_quality([
            {"claim_bearing": True, "has_citation": False, "citation_supports": False},
            {"claim_bearing": True, "has_citation": False, "citation_supports": False},
        ])
        self.assertEqual(q["citation_recall"], 0)
        self.assertIsNone(q["citation_precision"])
        self.assertEqual(q["counts"]["uncited_claims"], 2)

    def test_empty_and_nonlist(self):
        self.assertIsNone(compute_citation_quality([])["citation_recall"])
        self.assertEqual(compute_citation_quality(None)["counts"]["sentences"], 0)

    def test_rounding(self):
        q = compute_citation_quality([
            {"claim_bearing": True, "has_citation": True, "citation_supports": True},
            {"claim_bearing": True, "has_citation": True, "citation_supports": True},
            {"claim_bearing": True, "has_citation": False, "citation_supports": False},
        ])
        self.assertEqual(q["citation_recall"], 0.667)


if __name__ == "__main__":
    unittest.main(verbosity=2)

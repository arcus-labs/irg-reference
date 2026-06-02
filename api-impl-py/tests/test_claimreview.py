"""Unit tests for the ClaimReview projection (mirrors the JS test)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from irg.external_fact_check.claimreview import (  # noqa: E402
    verdict_to_rating,
    to_claim_review,
    to_claim_review_collection,
    REVIEW_RATING,
)


def make_citation(**over):
    base = {
        "claim_key": "abc123",
        "created_at": "2026-04-01T12:00:00.000Z",
        "verified_at": "2026-04-02T08:30:00.000Z",
        "claim": {"raw_text": "Saturn has rings."},
        "verdict": "supported",
        "verification_level": "verified",
        "confidence": 0.9,
        "sources": [
            {"url": "https://nasa.gov/saturn", "title": "NASA"},
            {"url": "https://example.com/rings"},
        ],
        "citation_path": "citations/2026-04/abc123-xyz.json",
    }
    base.update(over)
    return base


class TestClaimReview(unittest.TestCase):
    def test_verdict_to_rating(self):
        self.assertEqual(verdict_to_rating("supported")["ratingValue"], 5)
        self.assertEqual(verdict_to_rating("supported")["alternateName"], "True")
        self.assertEqual(verdict_to_rating("refuted")["ratingValue"], 1)
        self.assertEqual(verdict_to_rating("inconclusive")["alternateName"], "Unproven")
        self.assertEqual(verdict_to_rating("banana")["ratingValue"], 3)
        sup = verdict_to_rating("supported")
        self.assertEqual((sup["bestRating"], sup["worstRating"], sup["@type"]), (5, 1, "Rating"))
        self.assertEqual(REVIEW_RATING["supported"]["ratingValue"], 5)

    def test_to_claim_review(self):
        cr = to_claim_review(make_citation())
        self.assertEqual(cr["@type"], "ClaimReview")
        self.assertEqual(cr["claimReviewed"], "Saturn has rings.")
        self.assertEqual(cr["reviewRating"]["ratingValue"], 5)
        self.assertEqual(cr["author"]["@type"], "Organization")
        self.assertEqual(cr["itemReviewed"]["@type"], "Claim")
        self.assertEqual(len(cr["itemReviewed"]["appearance"]), 2)
        self.assertEqual(cr["itemReviewed"]["appearance"][0]["url"], "https://nasa.gov/saturn")
        self.assertEqual(cr["datePublished"], "2026-04-02")  # prefers verified_at, sliced
        self.assertEqual(cr["url"], "citations/2026-04/abc123-xyz.json")

    def test_fallbacks(self):
        cr = to_claim_review({"claim_text": "flat text", "verdict": "refuted", "created_at": "2026-01-05T00:00:00Z"})
        self.assertEqual(cr["claimReviewed"], "flat text")
        self.assertEqual(cr["datePublished"], "2026-01-05")
        self.assertNotIn("appearance", cr["itemReviewed"])
        self.assertEqual(cr["reviewRating"]["ratingValue"], 1)

        empty = to_claim_review({})
        self.assertEqual(empty["claimReviewed"], "")
        self.assertNotIn("datePublished", empty)
        self.assertNotIn("url", empty)

    def test_author_override_and_source_filter(self):
        cr = to_claim_review(make_citation(), author={"@type": "Organization", "name": "Custom"})
        self.assertEqual(cr["author"]["name"], "Custom")
        cr2 = to_claim_review(make_citation(sources=[{"url": ""}, {"url": None}, {"title": "no url"}, {"url": "https://ok.test"}]))
        self.assertEqual(len(cr2["itemReviewed"]["appearance"]), 1)
        self.assertEqual(cr2["itemReviewed"]["appearance"][0]["url"], "https://ok.test")

    def test_collection(self):
        verified = make_citation()
        provisional = make_citation(verification_level="provisional", verdict="inconclusive", claim={"raw_text": "Maybe."})
        doc = to_claim_review_collection([verified, provisional])
        self.assertEqual(doc["@context"], "https://schema.org")
        self.assertEqual(len(doc["@graph"]), 1)  # provisional excluded by default
        doc_incl = to_claim_review_collection([verified, provisional], include_provisional=True)
        self.assertEqual(len(doc_incl["@graph"]), 2)
        self.assertEqual(len(to_claim_review_collection([])["@graph"]), 0)
        self.assertEqual(len(to_claim_review_collection(None)["@graph"]), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

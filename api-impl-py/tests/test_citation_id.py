"""Conformance: derive_claim_uuid must reproduce the JS-derived UUIDs exactly
(shared fixture conformance/fixtures/citation-id/cases.json)."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from irg.citations.citation_id import derive_claim_uuid, IRG_CLAIM_NAMESPACE  # noqa: E402

FIXTURE = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "conformance", "fixtures", "citation-id", "cases.json")
)


class TestCitationId(unittest.TestCase):
    def test_namespace_matches_fixture(self):
        with open(FIXTURE, encoding="utf-8") as fh:
            data = json.load(fh)
        self.assertEqual(data["namespace"], IRG_CLAIM_NAMESPACE)

    def test_derived_uuids_match_js(self):
        with open(FIXTURE, encoding="utf-8") as fh:
            data = json.load(fh)
        for case in data["cases"]:
            with self.subTest(claim_key=case["claim_key"]):
                self.assertEqual(derive_claim_uuid(case["claim_key"]), case["uuid"])

    def test_deterministic_and_canonical_shape(self):
        a = derive_claim_uuid("abc")
        self.assertEqual(a, derive_claim_uuid("abc"))
        self.assertNotEqual(a, derive_claim_uuid("xyz"))
        self.assertRegex(a, r"^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

    def test_empty_key(self):
        self.assertEqual(derive_claim_uuid(""), "")
        self.assertEqual(derive_claim_uuid(None), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""Golden conformance: the Python apply_citations must produce IDENTICAL output
to the JS reference for the shared, language-neutral fixtures.

These are the same fixtures the JS impl runs (conformance/fixtures/citation-apply/).
This file is the proof that the port is behaviorally equivalent.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from irg.citations.apply import apply_citations  # noqa: E402

FIXTURE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "conformance", "fixtures", "citation-apply")
)


class TestCitationConformance(unittest.TestCase):
    def test_fixtures_exist(self):
        files = [f for f in os.listdir(FIXTURE_DIR) if f.endswith(".json")]
        self.assertTrue(len(files) > 0, f"no fixtures in {FIXTURE_DIR}")

    def test_each_fixture_matches(self):
        files = sorted(f for f in os.listdir(FIXTURE_DIR) if f.endswith(".json"))
        for fname in files:
            with self.subTest(fixture=fname):
                with open(os.path.join(FIXTURE_DIR, fname), encoding="utf-8") as fh:
                    fixture = json.load(fh)
                result = apply_citations(fixture["draft_with_tags"], fixture["citable_set"])
                expected = fixture["expected"]

                self.assertEqual(result["prose"], expected["validated_prose"],
                                 f"{fname}: validated_prose mismatch")
                self.assertEqual(result["references"], expected["references"],
                                 f"{fname}: references mismatch")
                if "stats" in expected:
                    self.assertEqual(result["stats"], expected["stats"],
                                     f"{fname}: stats mismatch")
                # Stronger byte-comparability check: canonical JSON of references.
                self.assertEqual(
                    json.dumps(result["references"], sort_keys=True),
                    json.dumps(expected["references"], sort_keys=True),
                    f"{fname}: references not byte-comparable",
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)

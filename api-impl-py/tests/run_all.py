#!/usr/bin/env python3
"""Run the full api-impl-py test suite (stdlib unittest discovery).

    python3 tests/run_all.py
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=HERE, pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()

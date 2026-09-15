"""Offline integrity checks for Meshy's embedded trust store (no device/API).

Fingerprints: https://www.amazontrust.com/repository/ (self-signed DER hashes).
Run: python -m unittest discover -s scripts/tests -p test_download_trust.py
"""
import hashlib
from pathlib import Path
import re
import ssl
import unittest

PROJECT = Path(__file__).resolve().parents[2]
EXPECTED = {
    "8ecde6884f3d87b1125ba31ac3fcb13d7016de7f57cc904fe1cb97c6ae98196e",
    "1ba5b2aa8c65401a82960118f80bec4f62304d83cec4713a19c39c011ea46db4",
    "18ce6cfe7bf14e60b2e347b8dfe868cb31d02ebb3ada271569f50343b46db3a4",
    "e35d28419ed02025cfa69038cd623962458da5c695fbdea3c22b0bfb25897092",
    "568d6905a2c88708a4b3025190edcfedb1974a606a13c6e5290fcb2ae63edab5",
}


class DownloadTrustTests(unittest.TestCase):
    def test_embedded_roots_match_published_fingerprints(self):
        source = (PROJECT / "src/meshy_ca.h").read_text(encoding="utf-8")
        body = source.split('R"PEM(', 1)[1].split(')PEM"', 1)[0]
        certs = re.findall(
            r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", body, re.S
        )
        self.assertEqual(len(certs), 5)
        hashes = {
            hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert)).hexdigest()
            for cert in certs
        }
        self.assertEqual(hashes, EXPECTED)
        # Parse the actual concatenated C-string payload as a trust store too.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cadata=body)
        self.assertEqual(context.cert_store_stats()["x509_ca"], 5)


if __name__ == "__main__":
    unittest.main()

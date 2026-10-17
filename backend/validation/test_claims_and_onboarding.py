#!/usr/bin/env python3
"""Tests for Contributor Provenance Claims, Persona RBAC, and Hackathon Pot Solvency."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from contributor_claims import (
    ContributorClaimRegistry,
    HackathonPotValidator,
    ROLE_SPONSOR,
    ROLE_LEAD,
    ROLE_MEMBER
)


class TestClaimsAndOnboarding(unittest.TestCase):

    def setUp(self):
        self.registry = ContributorClaimRegistry()
        self.validator = HackathonPotValidator()

    def test_impostor_claim_rejected(self):
        """Verify that an impostor cannot claim Maya Chen's $470 payout without git provenance."""
        with self.assertRaises(PermissionError) as ctx:
            self.registry.claim_payout(
                contributor_id="maya",
                oauth_github_username="evil_hacker",
                oauth_email="hacker@darkweb.org",
                paypal_recipient_email="hacker@paypal.com",
                tax_certified=True
            )
        self.assertIn("Impostor rejection", str(ctx.exception))

    def test_legitimate_claim_accepted(self):
        """Verify that an authentic git author (David Kim) successfully claims allocation."""
        profile = self.registry.claim_payout(
            contributor_id="david",
            oauth_github_username="davidkim",
            oauth_email="david@example.com",
            paypal_recipient_email="david.kim.finance@gmail.com",
            tax_form_type="W-9",
            tax_certified=True
        )
        self.assertEqual(profile["status"], "PAYOUT_READY")
        self.assertEqual(profile["paypal_recipient_email"], "david.kim.finance@gmail.com")
        self.assertEqual(profile["tax_form_type"], "W-9")
        self.assertTrue(profile["verification_proof"].startswith("PROOF-SHA256-"))

    def test_tax_certification_mandatory(self):
        """Verify that claims fail without W-8BEN/W-9 IRS self-certification."""
        with self.assertRaises(ValueError) as ctx:
            self.registry.claim_payout(
                contributor_id="tom",
                oauth_github_username="tomrivera",
                oauth_email="tom@example.com",
                paypal_recipient_email="tom.rivera@gmail.com",
                tax_certified=False
            )
        self.assertIn("IRS compliance self-certification", str(ctx.exception))

    def test_hackathon_pot_solvency_validation(self):
        """Verify that a hackathon prize pot is cryptographically validated and backed by PayPal hold."""
        cert = self.validator.validate_pot("HACKATHON-2026-Q4-JINJA")
        self.assertTrue(cert["is_solvent"])
        self.assertTrue(cert["quorum_ready"])
        self.assertEqual(cert["prize_pool_usd"], 2500.0)
        self.assertEqual(cert["paypal_auth_id"], "AUTH-PP-8829410-USD")
        self.assertTrue(cert["cryptographic_certificate"].startswith("POT-CERT-SHA256-"))
        self.assertEqual(cert["merkle_root"], "88643cd1b43fdaec0e1ed417cf98f835d55e389c4555c5a39628d5ff98ef69fc")

    def test_custom_pot_dynamic_validation(self):
        """Verify dynamic verification for arbitrary repository grant pots."""
        cert = self.validator.validate_pot("GRANT-FASTAPI-2026")
        self.assertTrue(cert["valid"])
        self.assertTrue(cert["non_retractable_hold"])
        self.assertTrue(cert["authorization_id"].startswith("AUTH-PP-"))


if __name__ == "__main__":
    unittest.main()

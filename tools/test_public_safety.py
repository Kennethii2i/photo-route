"""Synthetic credential regression tests; no real secrets or local env reads."""
import unittest

from check_public_safety import secret_findings


class SecretDetectionTests(unittest.TestCase):
    def test_esri_tokens_in_text_and_urls(self):
        for prefix in ('AAP' + 'K', 'AAP' + 'T'):
            token = prefix + 'synthetic' * 8 + '.AT2_' + 'synthetic' * 4
            for text in (token, f'https://example.invalid/?token={token}'):
                findings = secret_findings(text)
                self.assertIn('provider-token', findings)
                self.assertNotIn(token, repr(findings))

    def test_credential_assignments_without_known_token_prefix(self):
        value = 'synthetic' * 8
        for name in ('ARCGIS_API_KEY', 'ESRI_ACCESS_TOKEN', 'VITE_ESRI_TOKEN', 'NEXT_PUBLIC_ARCGIS_KEY'):
            for text in (f'{name}={value}', f'export {name}={value}', f'{name}="{value}"', f'"{name}": "{value}"'):
                findings = secret_findings(text)
                self.assertIn('esri-credential-assignment', findings)
                self.assertNotIn(value, repr(findings))

    def test_empty_templates_and_variable_references_are_not_credentials(self):
        for text in ('ARCGIS_API_KEY=', 'ARCGIS_API_KEY=""', 'ESRI_TOKEN', 'AAP' + 'T',
                     'ARCGIS_API_KEY=${LOCAL_VALUE}', 'process.env.ARCGIS_API_KEY',
                     'const env = { ARCGIS_API_KEY: value };'):
            self.assertEqual(secret_findings(text), [])

    def test_previous_provider_detection_is_preserved(self):
        token = 'gh' + 'p_' + 's' * 36
        self.assertIn('provider-token', secret_findings(token))


if __name__ == '__main__':
    unittest.main()

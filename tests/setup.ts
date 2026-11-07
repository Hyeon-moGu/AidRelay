// Dummy environment so lib/env.ts validates in unit tests. Nothing here reaches a real service:
// Firestore is replaced by tests/helpers/fake-firestore.ts and PayPal/Anthropic calls are mocked per test.
process.env.PAYPAL_ENV = "sandbox";
process.env.PAYPAL_CLIENT_ID = "test-client-id";
process.env.PAYPAL_CLIENT_SECRET = "test-client-secret";
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.GCS_BUCKET = "test-bucket";
process.env.APP_URL = "http://localhost:3000";
process.env.ADMIN_PASSWORD = "test-password";
process.env.AGENT_INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";
process.env.FUND_ID = "default";
process.env.AUTO_APPROVE_LIMIT = "250";
process.env.AUTO_APPROVE_MIN_CONFIDENCE = "0.85";
process.env.AUTO_APPROVE_DOUBLE_CHECK = "true";

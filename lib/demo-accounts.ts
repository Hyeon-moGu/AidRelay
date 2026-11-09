// The PayPal sandbox donor account judges pay with on /donate. It is a test account with pretend money, and the
// same email and password are published in the README (the hackathon rules ask for test credentials there);
// tests/demo-accounts.test.ts fails if the two drift apart.
export const SANDBOX_DONOR = {
  email: "sb-e3oaw53770647@personal.example.com",
  password: "3Y@}L@Zk",
} as const;

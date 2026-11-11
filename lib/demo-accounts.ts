// The PayPal sandbox donor account visitors pay with on /donate. It is a test account with pretend money; the page
// shows it on purpose, and the hackathon's testing instructions repeat it. tests/demo-accounts.test.ts checks it
// stays a sandbox account.
export const SANDBOX_DONOR = {
  email: "sb-e3oaw53770647@personal.example.com",
  password: "3Y@}L@Zk",
} as const;

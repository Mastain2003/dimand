-- Cached running balance per account (retailer owes distributor / distributor owes company).
-- ledger_entries stays the source of truth; this table is updated in the same batch as every ledger write,
-- so list screens do not have to add up thousands of ledger rows (keeps within free D1 read limits).
CREATE TABLE account_balances (
  account_type TEXT NOT NULL CHECK (account_type IN ('retailer','distributor')),
  account_id INTEGER NOT NULL,
  balance_paise INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_type, account_id)
);

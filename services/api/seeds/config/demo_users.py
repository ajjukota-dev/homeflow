"""Demo staff, one per role (HOMEFLOW_DEMO=1). Real names, `@pranava.local` addresses so
they can never collide with a live Workspace account (CLAUDE.md: real content, never
placeholder filler)."""
from __future__ import annotations

DEMO_USERS: tuple[tuple[str, str, str], ...] = (
    ("aarti.rao@pranava.local", "Aarti Rao", "super_admin"),
    ("rambabu.k@pranava.local", "Rambabu Kandimalla", "management"),
    ("nikhil.varma@pranava.local", "Nikhil Varma", "sales"),
    ("sneha.reddy@pranava.local", "Sneha Reddy", "crm"),
    ("prakash.iyer@pranava.local", "Prakash Iyer", "accounts"),
    ("meera.joshi@pranava.local", "Meera Joshi", "banking"),
    ("vikram.shetty@pranava.local", "Vikram Shetty", "legal"),
    ("latha.menon@pranava.local", "Latha Menon", "registration"),
    ("suresh.babu@pranava.local", "Suresh Babu", "site_engineer"),
    ("anil.kumar@pranava.local", "Anil Kumar", "qa"),
    ("ravi.teja@pranava.local", "Ravi Teja", "facility"),
    ("divya.nair@pranava.local", "Divya Nair", "design"),
    ("harish.gupta@pranava.local", "Harish Gupta", "procurement"),
)

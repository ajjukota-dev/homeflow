import { hash, verify } from "@node-rs/argon2";

// Rule 1: argon2id password hashes (@node-rs/argon2 defaults to argon2id).
export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  return verify(hashValue, password);
}

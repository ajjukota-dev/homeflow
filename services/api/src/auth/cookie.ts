import { parse, serialize } from "cookie";
import type { Request, Response } from "express";

// Rule 1: Set-Cookie: hf_session=…; HttpOnly; Secure; SameSite=Lax; Path=/.
// `Secure` is dropped outside production — the browser silently drops Secure
// cookies over http://localhost, which would break every local/CI login.
export const SESSION_COOKIE = "hf_session";

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  return parse(header)[SESSION_COOKIE] ?? null;
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    })
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })
  );
}

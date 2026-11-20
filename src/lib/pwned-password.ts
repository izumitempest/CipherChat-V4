// Password breach check using Have I Been Pwned's k-anonymity API.
//
// ⚠️  PRIVACY NOTICE: This sends the first 5 hex characters of the
// SHA-1 hash of the password to haveibeenpwned.com. This does not
// reveal the password itself, but it does reveal that someone is
// checking a password with that prefix. For a zero-knowledge product
// like CipherChat, this is a trade-off: the check is optional and
// only runs when the user explicitly opts in.
//
// CipherChat passwords are CSPRNG-generated from a 256-word list
// (6 words = 48 bits of entropy). They are not user-chosen and are
// extremely unlikely to appear in any breach database. This check is
// defense-in-depth, not a primary control.
//
// HIBP k-anonymity API:
//   1. SHA-1 hash the password
//   2. Send the first 5 uppercase hex chars of the hash
//   3. Get back a list of suffix:count lines for matching prefixes
//   4. Check if any suffix matches the full hash

const HIBP_API = "https://api.pwnedpasswords.com/range/";

function sha1Hex(password: string): Promise<string> {
  return crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)).then(
    (buf) => {
      const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return hex.toUpperCase();
    },
  );
}

/** Check if a password appears in Have I Been Pwned's breach database.
 *  Uses k-anonymity: only the first 5 hex chars of the SHA-1 hash
 *  are sent to the API. Returns true if the password was found in
 *  breaches, false if not, or throws on network error.
 *
 *  This is optional and should only be run with explicit user consent.
 *  It sends data to a third party (haveibeenpwned.com). */
export async function isPwnedPassword(password: string): Promise<boolean> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const res = await fetch(`${HIBP_API}${prefix}`, {
    headers: { "Accept": "application/vnd.haveibeenpwned.v2+json" },
  });
  if (!res.ok) throw new Error(`HIBP API returned ${res.status}`);
  const text = await res.text();
  for (const line of text.split("\r\n").filter(Boolean)) {
    const [lineSuffix, count] = line.split(":");
    if (lineSuffix === suffix) return true;
  }
  return false;
}

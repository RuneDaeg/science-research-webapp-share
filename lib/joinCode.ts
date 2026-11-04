const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 혼동되는 0/O, 1/I 제외

export function generateJoinCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

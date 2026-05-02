import { useEffect, useRef, useState } from "react";

const CORRECT_PIN = "2026";
const PIN_LENGTH = 4;
const SESSION_KEY = "codeathon_auth";

export default function PinAuth({ onUnlock }) {
  const [digits, setDigits] = useState(Array(PIN_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const inputs = useRef([]);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") onUnlock();
    else inputs.current[0]?.focus();
  }, []);

  function handleChange(value, idx) {
    if (!/^\d?$/.test(value)) return;
    const next = [...digits];
    next[idx] = value;
    setDigits(next);
    setError("");
    if (value && idx < PIN_LENGTH - 1) inputs.current[idx + 1]?.focus();
    if (next.every((d) => d !== "") && value) {
      verify(next.join(""));
    }
  }

  function handleKeyDown(e, idx) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  }

  function verify(pin) {
    if (pin === CORRECT_PIN) {
      sessionStorage.setItem(SESSION_KEY, "1");
      onUnlock();
    } else {
      setShake(true);
      setError("Incorrect PIN. Try again.");
      setDigits(Array(PIN_LENGTH).fill(""));
      setTimeout(() => { setShake(false); inputs.current[0]?.focus(); }, 600);
    }
  }

  return (
    <div className="pin-shell">
      <div className={`pin-card ${shake ? "pin-shake" : ""}`}>
        <p className="eyebrow" style={{ textAlign: "center", marginBottom: 8 }}>Codeathon 2K26</p>
        <h1 className="pin-title">Certificate Dashboard</h1>
        <p className="pin-sub">Enter your 4-digit PIN to continue</p>
        <div className="pin-inputs">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => (inputs.current[i] = el)}
              className="pin-input"
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleChange(e.target.value, i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
            />
          ))}
        </div>
        {error && <p className="pin-error">{error}</p>}
      </div>
    </div>
  );
}

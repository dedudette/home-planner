import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

/**
 * A labelled text field for the account forms: the label is tied to the input, a hint and an error are tied to it too (so a screen reader
 * reads them with the field), the error is announced when it appears, and the password variant has a Show/Hide button that says what it
 * does. Uses the app's own `.field` and `.input` styles, so sizes, focus rings and dark mode match everything else.
 */
export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}

export const Field = ({ label, value, onChange, error, hint, inputRef, id, type = 'text', ...rest }: FieldProps) => {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = `${fid}-hint`;
  const errId = `${fid}-err`;
  const [shown, setShown] = useState(false);
  const isPw = type === 'password';
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <div className={isPw ? 'pw-row' : undefined}>
        <input
          id={fid} ref={inputRef} className="input" type={isPw && shown ? 'text' : type} value={value}
          onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} {...rest}
        />
        {isPw && (
          <button type="button" className="pw-toggle" aria-pressed={shown} aria-controls={fid} onClick={() => setShown((s) => !s)}>
            {shown ? 'Hide' : 'Show'}<span className="sr-only"> password</span>
          </button>
        )}
      </div>
      {hint && <p id={hintId} className="small muted">{hint}</p>}
      {error && <p id={errId} className="field-error small" role="alert">{error}</p>}
    </div>
  );
};

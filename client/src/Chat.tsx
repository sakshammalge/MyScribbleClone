import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH, type ChatMessage } from '@inkling/shared';

interface ChatProps {
  messages: ChatMessage[];
  placeholder: string;
  onSend: (text: string) => void;
}

/** The margin notes: guesses, near misses and announcements, with the box to type them. */
export function Chat({ messages, placeholder, onSend }: ChatProps) {
  const [text, setText] = useState('');
  const log = useRef<HTMLOListElement>(null);

  // Stay pinned to the newest line.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };

  return (
    <section className="notes" aria-label="Chat">
      <ol ref={log} className="notes-log" role="log" aria-live="polite" data-testid="chat-log">
        {messages.map((m) => (
          <li
            key={m.id}
            className="note"
            data-kind={m.kind}
            data-insiders={m.insiders ? '' : undefined}
          >
            {m.kind === 'say' && <strong>{m.name}</strong>}{' '}
            {m.kind === 'correct' && <strong>{m.name}</strong>} <span>{m.text}</span>
            {m.insiders && <em className="tag">knows the word</em>}
          </li>
        ))}
      </ol>
      <form className="notes-form" onSubmit={submit}>
        <input
          aria-label="Guess or chat"
          placeholder={placeholder}
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

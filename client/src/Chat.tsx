import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH, type ChatMessage } from '@inkling/shared';
import { EmoteBar, EmoteLayer } from './Emotes';

interface ChatProps {
  messages: ChatMessage[];
  placeholder: string;
  onSend: (text: string) => void;
  /** Adds the reactions row above the input, and the floating emotes over the panel. */
  reactions?: boolean;
}

/** The margin notes: guesses, near misses and announcements, with the box to type them. */
export function Chat({ messages, placeholder, onSend, reactions = false }: ChatProps) {
  const [text, setText] = useState('');
  const [emotesOpen, setEmotesOpen] = useState(false);
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
    <section className="notes" aria-label="Chat" data-emotes={emotesOpen}>
      {reactions && <EmoteLayer />}
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
      {reactions && <EmoteBar id="reactions-row" />}
      <form className="notes-form" onSubmit={submit}>
        {reactions && (
          <button
            type="button"
            className="emote-toggle"
            aria-label="Show reactions"
            aria-expanded={emotesOpen}
            aria-controls="reactions-row"
            onClick={() => setEmotesOpen((v) => !v)}
          >
            ☺
          </button>
        )}
        <input
          aria-label="Guess or chat"
          placeholder={placeholder}
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="send" aria-label="Send" disabled={!text.trim()}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M4 12l16-8-6 16-3-7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
    </section>
  );
}

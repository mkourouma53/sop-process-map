import { useEffect, useRef, useState } from 'react';
import type { ChatAnswer, ChatTurn } from '../data';
import { IS_DEMO, askSop } from '../data';

interface Message { role: 'user' | 'assistant'; text: string; answer?: ChatAnswer; error?: string }

const SUGGESTIONS: Record<string, (process: string) => string[]> = {
  map: (p) => [`Walk me through the "${p}" process`, 'Which steps are inferred, and what does the SOP actually say there?', 'Where does work change hands in this process?'],
  risks: (p) => [`Which risk in "${p}" should be fixed first, and why?`, 'Explain the highest-severity risk in plain terms', 'Does the SOP contradict itself anywhere in this process?'],
  changes: (p) => [`What would it take to implement the top change for "${p}"?`, 'Which changes need no new software?', 'Which recommended changes should stay with a person, and why?'],
  future: (p) => [`What is different between today and the future state of "${p}"?`, 'Which steps are eliminated, and is that safe?', 'What does the owner need to approve for this future state?'],
};

interface Props {
  sopId: number;
  sopName: string;
  process: string;
  tab: string;
  tabLabel: string;
  onClose: () => void;
}

/** Sidebar chat about the open SOP. Answers come from the SOP document and its analysis, with page citations. */
export function AskAI({ sopId, sopName, process, tab, tabLabel, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next: Message[] = [...messages, { role: 'user', text: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    // Only text turns go back to the model; the flow adds the SOP and analysis in front.
    const turns: ChatTurn[] = next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.text }));
    try {
      const answer = await askSop(sopId, turns, `"${process}" process, ${tabLabel} screen`);
      setMessages([...next, { role: 'assistant', text: answer.parts.map((p) => p.text).join(''), answer }]);
    } catch (e) {
      setMessages([...next, { role: 'assistant', text: '', error: e instanceof Error ? e.message : 'Something went wrong' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="ask-panel" aria-label="Ask AI about this SOP">
      <header className="row ask-head">
        <div>
          <div style={{ fontWeight: 600 }}>Ask AI</div>
          <div className="muted" style={{ fontSize: 12 }}>Answers from {sopName} and its analysis, with page citations</div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={onClose} aria-label="Close Ask AI">✕</button>
      </header>

      <div className="ask-body">
        {messages.length === 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {IS_DEMO && <div className="banner">Ask AI runs in the production app, where the API key stays on the server. The suggestions show the kinds of questions it answers.</div>}
            <div className="muted" style={{ fontSize: 12 }}>Try asking about <b>{process}</b>:</div>
            {(SUGGESTIONS[tab] ?? SUGGESTIONS.map)(process).map((s) => (
              <button key={s} className="btn suggestion" disabled={IS_DEMO} onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (m.role === 'user'
          ? <div key={i} className="bubble user">{m.text}</div>
          : <AnswerView key={i} message={m} />))}
        {busy && <div className="bubble ai muted">Reading the SOP…</div>}
        <div ref={endRef} />
      </div>

      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <textarea rows={2} value={input} placeholder={IS_DEMO ? 'Available in the production app' : 'Ask about this SOP…'} disabled={IS_DEMO || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }} aria-label="Your question" />
        <button className="btn primary" type="submit" disabled={IS_DEMO || busy || !input.trim()}>Ask</button>
      </form>
    </aside>
  );
}

function AnswerView({ message }: { message: Message }) {
  if (message.error) return <div className="bubble ai error">{message.error}</div>;
  const citations = message.answer?.parts.flatMap((p) => p.citations) ?? [];
  let n = 0;
  return (
    <div className="bubble ai">
      <div style={{ whiteSpace: 'pre-wrap' }}>
        {message.answer?.parts.map((p, i) => (
          <span key={i}>{p.text}{p.citations.map(() => <sup key={++n} className="cite">[{n}]</sup>)}</span>
        ))}
      </div>
      {citations.length > 0 && (
        <ol className="sources">
          {citations.map((c, i) => (
            <li key={i}><span className="muted">p. {c.page}{c.endPage && c.endPage - 1 > (c.page ?? 0) ? `–${c.endPage - 1}` : ''}:</span> “{c.citedText.trim()}”</li>
          ))}
        </ol>
      )}
    </div>
  );
}

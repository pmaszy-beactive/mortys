import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircleQuestion, X, Send, Loader2, Sparkles } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "process_assistant_chat";

const WELCOME: ChatMessage = {
  role: "assistant",
  content:
    "Hi! I can answer questions about how Morty's Driving School works — booking rules, the 4-phase progression, payments, attendance, and more. What would you like to know?",
};

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return [WELCOME];
}

export default function ProcessAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages);
  const [input, setInput] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      // ignore
    }
  }, [messages]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const [isPending, setIsPending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const streamChat = async (allMessages: ChatMessage[]) => {
    setIsPending(true);
    setIsStreaming(false);
    let addedAssistantMessage = false;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const token = localStorage.getItem("student_auth_token");
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {
        // ignore
      }

      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          // Only send real conversation turns (skip the local welcome message)
          messages: allMessages.filter((m, i) => !(i === 0 && m.role === "assistant")).slice(-12),
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("text/event-stream")) {
        let message = "Something went wrong. Please try again.";
        try {
          const data = await res.json();
          if (data?.message) message = data.message;
        } catch {
          // ignore
        }
        setErrorText(message);
        return;
      }

      if (!res.body) {
        setErrorText("Something went wrong. Please try again.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      const appendDelta = (delta: string) => {
        if (!addedAssistantMessage) {
          addedAssistantMessage = true;
          setIsStreaming(true);
          setMessages((prev) => [...prev, { role: "assistant", content: delta }]);
        } else {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const line = event.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.delta) appendDelta(payload.delta);
            if (payload.error) streamError = payload.error;
          } catch {
            // ignore malformed chunk
          }
        }
      }

      if (streamError) {
        setErrorText(streamError);
      } else if (!addedAssistantMessage) {
        setErrorText("The assistant couldn't generate a response. Please try again.");
      } else {
        setErrorText(null);
      }
    } catch {
      setErrorText(
        addedAssistantMessage
          ? "The assistant's reply was cut off. Please try again."
          : "Unable to connect to the server. Please check your internet connection."
      );
    } finally {
      setIsPending(false);
      setIsStreaming(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || isPending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setErrorText(null);
    void streamChat(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-[#111111] text-[#ECC462] shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
          aria-label="Ask the school assistant"
          data-testid="button-open-assistant"
        >
          <MessageCircleQuestion className="h-7 w-7" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed z-50 inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[380px] sm:h-[560px] sm:max-h-[calc(100vh-2.5rem)] bg-white sm:rounded-xl shadow-2xl border border-gray-200 flex flex-col"
          data-testid="panel-assistant"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#111111] text-white sm:rounded-t-xl">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-[#ECC462] flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-[#111111]" />
              </div>
              <div>
                <div className="text-sm font-semibold">School Assistant</div>
                <div className="text-[11px] text-gray-400">Questions about how the school works</div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-white p-1"
              aria-label="Close assistant"
              data-testid="button-close-assistant"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`message-${m.role}-${i}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-[#111111] text-white"
                      : "bg-white border border-gray-200 text-gray-800"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {isPending && !isStreaming && (
              <div className="flex justify-start" data-testid="status-assistant-typing">
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                </div>
              </div>
            )}
            {errorText && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="text-assistant-error">
                {errorText}
              </div>
            )}
          </div>

          {/* Disclaimer */}
          <div className="px-4 pt-2 text-[10px] leading-tight text-gray-400">
            Answers are informational only — the office is the final authority. For account-specific questions, please contact the office.
          </div>

          {/* Input */}
          <div className="p-3 flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about booking rules, payments…"
              rows={1}
              className="resize-none min-h-[40px] max-h-28 text-sm"
              data-testid="input-assistant-message"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isPending}
              className="bg-[#ECC462] hover:bg-[#ECC462]/90 text-[#111111] h-10 w-10 p-0 shrink-0"
              aria-label="Send message"
              data-testid="button-send-assistant"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

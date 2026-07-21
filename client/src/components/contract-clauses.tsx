import { useRef } from "react";
import type { MutableRefObject } from "react";
import SignaturePad, { type SignaturePadRef } from "@/components/signature-pad";
import { CONTRACT_CLAUSES, type ContractClauseInitials } from "@shared/schema";
import { CheckCircle, PenLine } from "lucide-react";

export type ClausePadsRef = MutableRefObject<Record<string, SignaturePadRef | null>>;

export function useClausePads(): ClausePadsRef {
  return useRef<Record<string, SignaturePadRef | null>>({});
}

export function collectClauseInitials(padsRef: ClausePadsRef): { initials: ContractClauseInitials; missing: string[] } {
  const initials: ContractClauseInitials = {};
  const missing: string[] = [];
  const now = new Date().toISOString();
  for (const clause of CONTRACT_CLAUSES) {
    const pad = padsRef.current[clause.id];
    const signature = pad?.getSignature() || null;
    if (signature) {
      initials[clause.id] = { initials: signature, initialedAt: now };
    } else {
      missing.push(clause.title);
    }
  }
  return { initials, missing };
}

export function ContractClausesCapture({ padsRef }: { padsRef: ClausePadsRef }) {
  return (
    <div className="space-y-4" data-testid="section-clause-initials">
      <div className="flex items-center gap-2">
        <PenLine className="h-4 w-4 text-[#ECC462]" />
        <h3 className="text-sm font-semibold text-gray-900">
          Mandatory Clauses — each must be initialed
        </h3>
      </div>
      {CONTRACT_CLAUSES.map((clause, index) => (
        <div
          key={clause.id}
          className="border border-gray-200 rounded-md p-4 space-y-3 bg-gray-50/50"
          data-testid={`clause-capture-${clause.id}`}
        >
          <p className="text-sm font-semibold text-gray-900">
            {index + 1}. {clause.title}
          </p>
          <p className="text-sm text-gray-700 whitespace-pre-line">{clause.text}</p>
          <SignaturePad
            ref={(el) => {
              padsRef.current[clause.id] = el;
            }}
            title={`Initials — ${clause.title}`}
            height={100}
          />
        </div>
      ))}
    </div>
  );
}

export function ContractClausesDisplay({ clauseInitials }: { clauseInitials?: ContractClauseInitials | null }) {
  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-4" data-testid="section-clause-display">
      <h3 className="text-sm font-semibold text-gray-900">Mandatory Clauses</h3>
      {CONTRACT_CLAUSES.map((clause, index) => {
        const entry = clauseInitials?.[clause.id];
        return (
          <div
            key={clause.id}
            className="border border-gray-200 rounded-md p-4 space-y-2"
            data-testid={`clause-display-${clause.id}`}
          >
            <p className="text-sm font-semibold text-gray-900">
              {index + 1}. {clause.title}
            </p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{clause.text}</p>
            {entry ? (
              <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
                <img
                  src={entry.initials}
                  alt={`Initials for ${clause.title}`}
                  className="h-12 bg-white border rounded"
                  data-testid={`img-initials-${clause.id}`}
                />
                <div className="text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                    <CheckCircle className="h-3.5 w-3.5" /> Initialed
                  </span>
                  <p data-testid={`text-initialed-at-${clause.id}`}>{formatDate(entry.initialedAt)}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500 pt-2 border-t border-gray-100" data-testid={`text-no-initials-${clause.id}`}>
                Not initialed (contract signed before clause initialing was required).
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

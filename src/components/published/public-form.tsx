"use client";

import { submitPublicFormAction } from "@/app/actions/forms";
import { postFile } from "@/components/database/files-cell";
import { FormFill } from "@/components/database/form-fill";
import type { PublicForm } from "@/server/forms";

/**
 * A public form (`/f/<token>`), filled in by anyone with the link. `note` says whether answers are
 * anonymous or who is answering.
 */
export function PublicFormFill({ form, ticket, note }: { form: PublicForm; ticket: string; note: string }) {
  return (
    <FormFill
      title={form.title}
      description={form.description}
      questions={form.questions}
      confirmation={form.confirmation}
      allowAnother={form.allowAnother}
      honeypot
      note={note}
      upload={(file) => postFile(`/api/files?formToken=${encodeURIComponent(form.token)}`, file, { "X-Form-Ticket": ticket })}
      onSubmit={async (answers, { honeypot }) => {
        const result = await submitPublicFormAction(form.token, { answers, ticket, honeypot });
        return result.ok ? { ok: true } : result;
      }}
    />
  );
}

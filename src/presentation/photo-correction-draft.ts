export type CorrectionFields = { latitude: string; longitude: string; clock: string; offset: string };

/** Presentation-only inputs. Source metadata and persisted corrections stay in the repository. */
export class PhotoCorrectionDrafts {
  private readonly drafts = new Map<string, { values: CorrectionFields; saved: CorrectionFields }>();

  read(id: string, saved: CorrectionFields): CorrectionFields {
    let draft = this.drafts.get(id);
    if (!draft) { draft = { values: { ...saved }, saved: { ...saved } }; this.drafts.set(id, draft); }
    for (const field of Object.keys(saved) as Array<keyof CorrectionFields>) {
      if (draft.values[field] === draft.saved[field]) draft.values[field] = saved[field];
    }
    draft.saved = { ...saved };
    return draft.values;
  }
  change(id: string, field: keyof CorrectionFields, value: string): void {
    const draft = this.drafts.get(id); if (draft) draft.values[field] = value;
  }
  dirty(id: string | null): boolean {
    const draft = id ? this.drafts.get(id) : undefined;
    return Boolean(draft && (Object.keys(draft.values) as Array<keyof CorrectionFields>).some(field => draft.values[field] !== draft.saved[field]));
  }
  get hasChanges(): boolean { return [...this.drafts.keys()].some(id => this.dirty(id)); }
  discard(id: string): void { this.drafts.delete(id); }
}

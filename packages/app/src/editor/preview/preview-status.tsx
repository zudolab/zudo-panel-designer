export function PreviewRendererUnavailable({ detail }: { readonly detail?: string }) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="mb-28 w-[calc(100%-3rem)] max-w-md rounded-lg border border-amber-400/35 bg-amber-950/35 p-5 text-center shadow-lg"
    >
      <h3 className="text-base font-semibold text-amber-100">3D preview unavailable</h3>
      <p className="mt-2 text-sm leading-relaxed text-amber-100/80">
        {detail ?? 'This browser or device could not start the WebGL renderer.'}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-neutral-300">
        Your panel remains unchanged. Close the preview to continue editing.
      </p>
    </section>
  );
}

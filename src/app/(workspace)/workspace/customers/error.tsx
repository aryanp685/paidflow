"use client";
export default function CustomerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="customer-result" role="alert"><h2>Customers could not be loaded</h2><p>Please try again. No customer or financial information has been assumed.</p><button className="draft-add" type="button" onClick={reset}>Try again</button></div>;
}

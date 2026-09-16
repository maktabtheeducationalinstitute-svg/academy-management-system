// Printing print-area content in place (via window.print() + CSS visibility
// tricks) is unreliable in Chromium once there's enough *hidden* sibling
// content on the page — it can still reserve blank pages for content that's
// invisible but tall, even with `overflow: hidden` collapsing its ancestor.
// Printing from a throwaway iframe containing only the target element (and a
// clone of the app's stylesheets) sidesteps that entirely: there's nothing
// else in that document to mispaginate around.
export function printElement(element: HTMLElement | null, options?: { landscape?: boolean }) {
  if (!element) return

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    iframe.remove()
    return
  }

  const headHtml = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((el) => el.outerHTML).join('')

  // The cloned stylesheet still carries `.print-area { position: fixed }` +
  // `body { height: 0; overflow: hidden }` — the trick that lets print-area
  // content escape OTHER page content when printing in place. In this
  // iframe there's nothing else to escape from (the body's only child is
  // the print-area itself), so that trick is not just unnecessary here but
  // actively harmful: a print engine calculates how many pages to emit from
  // the normal document flow's height, which this collapses to zero,
  // silently truncating anything taller than a single page (multi-page
  // content like a big student-card sheet or a long table just gets cut
  // off rather than flowing onto page 2+). Overriding back to normal flow
  // for this isolated document fixes that without touching the shared
  // stylesheet other in-place print flows still rely on.
  // Landscape is opt-in per call (e.g. a side-by-side fee voucher needs the
  // width) rather than a global rule, since most print jobs — cards, exam
  // papers, the timetable — are portrait and share this same stylesheet.
  const landscapeRule = options?.landscape ? '@page { size: landscape; }' : ''
  const overrideStyle = `<style>${landscapeRule}@media print { body { height: auto !important; overflow: visible !important; } .print-area { position: static !important; left: auto !important; top: auto !important; width: auto !important; } }</style>`

  doc.open()
  doc.write(`<!DOCTYPE html><html><head>${headHtml}${overrideStyle}</head><body>${element.outerHTML}</body></html>`)
  doc.close()

  function cleanup() {
    setTimeout(() => iframe.remove(), 500)
  }

  function go() {
    win!.focus()
    win!.print()
    cleanup()
  }

  const linkEls = [...doc.querySelectorAll('link[rel="stylesheet"]')] as HTMLLinkElement[]
  const pending = linkEls.filter((l) => !l.sheet)
  if (pending.length === 0) {
    // Dev mode inlines styles as <style> tags (no network fetch to wait on);
    // still defer a tick so the iframe has finished laying out.
    setTimeout(go, 50)
    return
  }
  let remaining = pending.length
  function onSettle() {
    remaining--
    if (remaining === 0) go()
  }
  for (const link of pending) {
    link.addEventListener('load', onSettle, { once: true })
    link.addEventListener('error', onSettle, { once: true })
  }
}

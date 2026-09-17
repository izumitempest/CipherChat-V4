/** A quiet grabber at the top of a bottom sheet — a fold in the paper,
 *  not a handle that promises dragging. */
export function SheetGrabber() {
  return (
    <div
      className="mx-auto mb-4 h-1 w-9 rounded-full bg-mute/35"
      aria-hidden="true"
    />
  );
}

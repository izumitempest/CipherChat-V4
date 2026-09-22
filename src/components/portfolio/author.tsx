"use client";

import { Section } from "./section";

/* The author: name, alias, license. One paragraph, no banner
 * art, no signature conceits. */

export function Author() {
  return (
    <Section id="author" title="The author">
      <div className="max-w-[60ch] space-y-4">
        <p className="font-serif text-[17px] leading-[1.6]">
          Okwuchukwu Ekene Don Davies
          <span className="text-mute">, known as Izumi</span>
        </p>
        <p className="font-sans text-[14.5px] leading-[1.75] text-charcoal/85">
          CipherChat was built as an IT project and is released under the MIT
          License. It was designed and built end to end by Izumi. Claims are
          checked against the code, and known limits are written down rather
          than hidden.
        </p>
      </div>
    </Section>
  );
}

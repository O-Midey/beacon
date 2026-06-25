import { devto } from "./devto.js";
import { linkedin } from "./linkedin.js";
import { twitter } from "./twitter.js";

export { twitter, linkedin, devto };

/** All platform configs, ordered as they appear in a DraftSet. */
export const platforms = [twitter, linkedin, devto] as const;

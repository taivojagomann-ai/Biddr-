/** An uploaded report file: its path in the private inspection-uploads bucket and the name the seller saw. */
export interface ReportFile {
  path: string;
  name: string;
}

/** Report path inside the bucket: <user id>/<draft id>/<uuid>.<ext> */
export const REPORT_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/;

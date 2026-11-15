/* REAL NASA DATA — transcribed from the NASA Open Science Data Repository (OSDR).
 *
 *   Study:      OSD-569 (GLDS-561 / LSDS-7), "Whole Blood Measurements from the SpaceX Inspiration4 Mission"
 *   File:       LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv  (public, ALSDA-transformed)
 *   Retrieved:  2026-11-14 through the OSDR public API (https://osdr.nasa.gov/osdr/data/osd/files/569)
 *   Mission:    SpaceX Inspiration4, 3-day low-Earth-orbit mission, 16-18 Sep 2021, four crew members
 *   Timepoints: L-92, L-44, L-3 (days before launch) and R+1, R+45, R+82, R+194 (days after return)
 *
 * Values are copied unchanged from the file. Deliberate exclusions, listed in `excluded`:
 *   - C003 L-92: the row is internally inconsistent (e.g. absolute neutrophils 10.1 cells/uL next to
 *     absolute lymphocytes 6826 cells/uL), so it is treated as a misaligned record and left out.
 *   - C002 R+194 MCV is blank in the source file (stored as null).
 * Reference sets (A / B) are the lab reference ranges that the file attaches to each sample. They differ
 * only for haemoglobin, haematocrit and red-cell count, and the file attaches set B to C003's post-flight
 * samples but set A to the same person's pre-flight samples. The app reports that inconsistency rather than
 * hiding it.
 * Attribution: NASA OSDR / Inspiration4 SOMA consortium (Mason lab, Weill Cornell Medicine). Public data.
 */
(function (root) {
  const ANALYTES = [
    { id: 'wbc', label: 'White blood cells', unit: '10³/µL', dec: 1 },
    { id: 'anc', label: 'Neutrophils (absolute)', unit: 'cells/µL', dec: 0 },
    { id: 'alc', label: 'Lymphocytes (absolute)', unit: 'cells/µL', dec: 0 },
    { id: 'amc', label: 'Monocytes (absolute)', unit: 'cells/µL', dec: 0 },
    { id: 'plt', label: 'Platelets', unit: '10³/µL', dec: 0 },
    { id: 'hgb', label: 'Haemoglobin', unit: 'g/dL', dec: 1 },
    { id: 'hct', label: 'Haematocrit', unit: '%', dec: 1 },
    { id: 'rbc', label: 'Red blood cells', unit: '10⁶/µL', dec: 2 },
    { id: 'mcv', label: 'Mean cell volume (MCV)', unit: 'fL', dec: 1 },
    { id: 'rdw', label: 'Red-cell distribution width', unit: '%', dec: 1 },
    { id: 'neutp', label: 'Neutrophils', unit: '%', dec: 1 },
    { id: 'lymp', label: 'Lymphocytes', unit: '%', dec: 1 },
  ];
  // order of the arrays below follows ANALYTES
  const REF = {
    A: [[3.8, 10.8], [1500, 7800], [850, 3900], [200, 950], [140, 400], [13.2, 17.1], [38.5, 50], [4.2, 5.8], [80, 100], [11, 15], [38, 80], [15, 49]],
    B: [[3.8, 10.8], [1500, 7800], [850, 3900], [200, 950], [140, 400], [11.7, 15.5], [35, 45], [3.8, 5.1], [80, 100], [11, 15], [38, 80], [15, 49]],
  };
  const TIMEPOINTS = [
    { id: 'L-92', x: -92 },
    { id: 'L-44', x: -44 },
    { id: 'L-3', x: -3 },
    { id: 'R+1', x: 4 },
    { id: 'R+45', x: 48 },
    { id: 'R+82', x: 85 },
    { id: 'R+194', x: 197 },
  ]; // x = days from launch (mission lasted 3 days, so R+n = launch + 3 + n)
  const N = null;
  const CREW = {
    C001: {
      'L-92': ['A', [5.4, 2349, 2241, 481, 241, 14.1, 42.5, 4.58, 92.8, 13, 43.5, 41.5]],
      'L-44': ['A', [5.5, 2998, 1859, 391, 237, 14.9, 45.1, 4.85, 93, 12.6, 54.5, 33.8]],
      'L-3': ['A', [7, 3570, 2667, 553, 258, 14.7, 44.5, 4.69, 94.9, 12.6, 51, 38.1]],
      'R+1': ['A', [5, 2685, 1640, 455, 227, 14.7, 43.6, 4.84, 90.1, 12.5, 53.7, 32.8]],
      'R+45': ['A', [4.9, 2200, 2146, 368, 228, 14.3, 43.3, 4.63, 93.5, 12.8, 44.9, 43.8]],
      'R+82': ['A', [4.9, 1994, 2171, 485, 257, 15.7, 46.1, 5.02, 91.8, 12.3, 40.7, 44.3]],
      'R+194': ['A', [4.9, 2391, 1847, 392, 214, 14.1, 41.8, 4.66, 89.7, 12.8, 48.8, 37.7]],
    },
    C002: {
      'L-92': ['B', [6.5, 3705, 2119, 364, 241, 13.2, 40.8, 4.36, 93.6, 12.7, 57, 32.6]],
      'L-44': ['B', [5.4, 2873, 1982, 302, 229, 12.8, 37.8, 3.93, 96.2, 12.6, 53.2, 36.7]],
      'L-3': ['B', [7.2, 3701, 2873, 446, 241, 11.5, 35.9, 3.72, 96.5, 12.1, 51.4, 39.9]],
      'R+1': ['B', [5.5, 3328, 1540, 435, 252, 12.1, 36.4, 4.02, 90.5, 11.8, 60.5, 28]],
      'R+45': ['B', [6.4, 2765, 2874, 499, 252, 12.2, 37.1, 4.02, 92.3, 12, 43.2, 44.9]],
      'R+82': ['B', [5.3, 3132, 1701, 345, 245, 11.5, 34.7, 3.84, 90.4, 11.9, 59.1, 32.1]],
      'R+194': ['B', [6.4, 3123, 2573, 518, 243, 12.7, 38.3, 4.11, N, 12.1, 48.8, 40.2]],
    },
    C003: {
      'L-44': ['A', [9.3, 6408, 2083, 632, 345, 14.4, 42.6, 4.62, 92.2, 13.2, 68.9, 22.4]],
      'L-3': ['A', [9.8, 5792, 3156, 715, 367, 13.3, 41.6, 4.5, 92.4, 12.5, 59.1, 32.2]],
      'R+1': ['B', [7, 4088, 2086, 658, 359, 13.5, 41.4, 4.67, 88.7, 12.7, 58.4, 29.8]],
      'R+45': ['B', [7.8, 4618, 2379, 624, 396, 14.6, 44.3, 5.09, 87, 12.5, 59.2, 30.5]],
      'R+82': ['B', [8.8, 4576, 3247, 730, 345, 14.4, 44.6, 4.89, 91.2, 12.9, 52, 36.9]],
      'R+194': ['B', [7.4, 4151, 2220, 762, 185, 13.3, 40.4, 4.64, 87.1, 13.1, 56.1, 30]],
    },
    C004: {
      'L-92': ['A', [7.7, 4766, 1786, 870, 239, 17, 49.1, 5.48, 89.6, 12.5, 61.9, 23.2]],
      'L-44': ['A', [6.4, 3699, 1613, 832, 227, 16.6, 50, 5.57, 89.8, 12.7, 57.8, 25.2]],
      'L-3': ['A', [10.6, 6318, 2947, 965, 295, 16.8, 49, 5.4, 90.7, 13.3, 59.6, 27.8]],
      'R+1': ['A', [8.1, 4528, 2155, 1029, 240, 16.5, 48.3, 5.55, 87, 13.2, 55.9, 26.6]],
      'R+45': ['A', [6.8, 3618, 1938, 898, 281, 16.8, 49, 5.54, 88.4, 12.6, 53.2, 28.5]],
      'R+82': ['A', [7.9, 4361, 2307, 916, 198, 16.4, 47.5, 5.45, 87.2, 12.9, 55.2, 29.2]],
      'R+194': ['A', [8.3, 4200, 2639, 988, 256, 16.5, 48, 5.58, 86, 13.1, 50.6, 31.8]],
    },
  };
  root.OSDR_CBC = {
    accession: 'OSD-569',
    identifiers: 'GLDS-561, LSDS-7',
    title: 'Whole Blood Measurements from the SpaceX Inspiration4 Mission',
    mission: 'SpaceX Inspiration4 (3 days, low Earth orbit, 16–18 Sep 2021)',
    file: 'LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv',
    retrieved: '2026-11-14',
    apiUrl: 'https://osdr.nasa.gov/osdr/data/osd/files/569',
    studyUrl: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-569',
    excluded: [
      'C003 L-92: row is internally inconsistent (e.g. absolute neutrophils 10.1 cells/µL next to absolute lymphocytes 6826 cells/µL); treated as a misaligned record and omitted.',
      'C002 R+194 MCV is blank in the source file.',
      'The source file labels haemoglobin units as "percent"; values and reference ranges are consistent with g/dL, which is what this app shows.',
      'The file attaches reference set B to C003’s post-flight samples but set A to the same person’s pre-flight samples.',
    ],
    ANALYTES, REF, TIMEPOINTS, CREW,
  };
})(typeof self !== 'undefined' ? self : this);

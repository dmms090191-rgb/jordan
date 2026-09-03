/* France 3D — geometrie du territoire — genere par review/build-geo3d.mjs — NE PAS EDITER A LA MAIN.
   Source : review/gen/france-regions.geojson (IGN via france-geojson, 13 regions, Corse incluse).

   REPERES
   - project(lat, lon) -> [x, y] dans le repere SVG 1000 x 930, STRICTEMENT identique a assets/js/france-geo.js
     (memes constantes de Lambert conique conforme) : les positions coincident avec la carte SVG du site.
   - toWorld([x, y]) -> [x, y] en unites MONDE : x vers l'est, y vers le NORD (l'axe SVG est inverse),
     origine au centre du territoire, plus grande dimension normalisee sur [-1, 1] (largeur = 2).
   - projectWorld(lat, lon) = toWorld(project(lat, lon)) : a utiliser pour poser villes, pins et labels.
   - Pose dans le plan XZ de Three.js : construire les THREE.Shape avec les points [x, y] tels quels,
     puis geometry.rotateX(-Math.PI / 2). Le nord se retrouve vers -Z, l'est vers +X.
     (equivalent direct : xz = [x, -y]).
   - Echelle : 1 unite monde ~ 569 km, 1 unite SVG ~ 1.137 km.

   DONNEES
   - REGIONS : [{ nom, code, polygons:[{ outer:Ring, holes:[Ring] }], rings:[Ring], centroid:[x,y], bbox:[x0,y0,x1,y1], area }]
     Ring = { pts:[[x,y], ...], hole:boolean, area, bbox }.
     Les anneaux sont FERMES IMPLICITEMENT (le dernier point ne repete pas le premier) et sans doublon
     consecutif ; contour en sens trigonometrique (aire > 0), trous en sens horaire — pret pour
     THREE.Shape / THREE.ShapeUtils.triangulateShape / ExtrudeGeometry.
   - OUTLINE : contour EXTERIEUR du territoire (littoral + frontieres nationales + enclaves), sous forme
     de polylignes fermees [[x,y], ...] triees de la plus longue a la plus courte (continent, Corse, iles).
     Pour un trace lumineux progressif : parcourir OUTLINE[0] puis les suivantes.
   - OUTLINE_SEGMENTS : les memes donnees mises a plat en paires de points, pour un THREE.BufferGeometry
     de LineSegments : [x1,y1, x2,y2, ...].
   - BORDERS : frontieres INTERNES entre regions, DEDOUBLONNEES (une frontiere partagee n'apparait
     qu'une seule fois), sous forme de polylignes.
   - BOUNDS : cadrage SVG et monde, centre, echelle, bbox du continent seul (BOUNDS.mainland), de la
     Corse (BOUNDS.corsica) et centre de gravite du territoire (BOUNDS.centroid).
   - regionAt(x, y) / contains(x, y) : reperage d'un point monde (mer / terre, quelle region) —
     pour clipper un maillage de relief ou survoler sans raycast.

   RELIEF (geographie reelle, amplitude 2 % de la largeur du territoire)
   - RELIEF.massifs : 42 massifs, 237 ancres, 195 segments. Chaque massif est une LIGNE DE
     CRETE ('c') ou un SOCLE ('s') : une polyligne d'ancres { lat, lon, rayon (km), hauteur (m), x, y, r, h }
     ou x, y, r sont en unites monde et h l'altitude normalisee (1 = 4810 m, le Mont Blanc).
     Ce sont les vraies chaines : arc alpin, crete pyreneenne d'ocean a Mediterranee, Jura, Vosges,
     Massif central (Puys-Cantal-Aubrac, Margeride-Lozere-Aigoual, Forez, Vivarais...), Morvan,
     Armorique, bocage normand, Provence, Corse ; les socles portent les plateaux (piemont pyreneen,
     plateau du Massif central, Limousin, Lorraine-Langres, Causses...). Les plaines (Beauce, Landes,
     Flandre, Sologne, Bresse, plaine d'Alsace, Champagne) ne portent AUCUN massif.
   - RELIEF.anchors : les memes ancres a plat, dans l'ordre des massifs.
   - sampleRelief(x, y) -> hauteur en unites monde. Union en p-norme des capsules de crete, deformation
     du domaine (les cretes ondulent), grain de versant en fBm, murmure des plaines. Analytique, ~1 us.
     Le relief se SENT en lumiere rasante ; il ne se voit jamais comme des pics.
   - buildReliefGrid(w, h) cuit une carte de hauteur (Float32Array) ; sampleReliefGrid(g, x, y) la lit
     en bilineaire. Pour un maillage dense, cuire la grille est 8 fois plus rapide.
   - RELIEF.gain calibre pour que le maximum du champ vaille exactement RELIEF.max.
   - Les plaines ne sont pas une table : elles ondulent entre 0 et ~4 % de RELIEF.max. Un moteur qui
     veut un littoral rigoureusement a plat retranche cette base et clampe a 0.

   RECETTE POUR LE MOTEUR (lot carte3d)
   1. cuire la grille une fois : const g = buildReliefGrid(768) ;
   2. mailler la bbox monde a ~380 x 354 (= ~120 k triangles, le budget de la charte pour tout le
      territoire) ; hauteur d'un sommet = contains(x, y) ? sampleReliefGrid(g, x, y) : 0 ;
   3. garder une cellule des qu'UN de ses quatre coins est a terre, et teinter les sommets en mer a la
      couleur du fond : le littoral se termine en fondu au lieu d'un escalier de cellules ;
   4. tracer OUTLINE / OUTLINE_SEGMENTS par-dessus, a la hauteur sampleRelief du point, pour le liseré or.

   FABRICATION : topologie facon TopoJSON (arcs partages), Douglas-Peucker 0.4 unite SVG par arc,
   quantification 1/4096 d'unite monde, varint base64. Une frontiere partagee est donc rigoureusement
   identique des deux cotes : aucune fente entre regions.
*/

/* ---- projection (identique a assets/js/france-geo.js) ---- */
export const FRANCE_VIEWBOX = [0, 0, 1000, 930];
const D2R = Math.PI / 180, phi0 = 46.5 * D2R, phi1 = 44 * D2R, phi2 = 49 * D2R, lon0 = 3 * D2R;
const n = 0.7256048376793143, F = 1.8461473497543408, rho0 = 0.9477600800154734, minX = -0.09362313780269853, minY = -0.08638498086213653, S = 5602.024524205446, H = 930;
export function project(lat, lon) { const rho = F / Math.pow(Math.tan(Math.PI / 4 + lat * D2R / 2), n); const th = n * (lon * D2R - lon0); const x = rho * Math.sin(th), y = rho0 - rho * Math.cos(th); return [(x - minX) * S, H - (y - minY) * S]; }

/* ---- repere monde ---- */
const CX = 500.085377, CY = 463.820452, SCALE = 0.0019996585509199165;
export function toWorld(p) { return [(p[0] - CX) * SCALE, (CY - p[1]) * SCALE]; }
export function toSvg(p) { return [p[0] / SCALE + CX, CY - p[1] / SCALE]; }
export function projectWorld(lat, lon) { return toWorld(project(lat, lon)); }

export const BOUNDS = {
  viewBox: [0, 0, 1000, 930],
  svg: { x: [0, 1000.170754], y: [-2.69368, 930.334585], center: [CX, CY], width: 1000.170754, height: 933.028265 },
  world: { x: [-1, 1], y: [-0.932869, 0.932869], width: 2, height: 1.865738 },
  mainland: [-1, -0.778809, 0.719971, 0.932861], corsica: [0.851563, -0.932861, 0.999756, -0.610107],
  centroid: [-0.008154, 0.037593],
  scale: SCALE, kmPerUnit: 568.730808, kmPerSvgUnit: 1.137267
};

/* ---- decodage des arcs ---- */
const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-';
const IDX = (() => { const m = new Int8Array(128); for (let i = 0; i < 64; i++) m[A64.charCodeAt(i)] = i; return m; })();
const Q = 4096;
function decodeArcs(s) {
  let p = 0;
  const rd = () => { let v = 0, sh = 1, c; do { c = IDX[s.charCodeAt(p++)]; v += (c & 31) * sh; sh *= 32; } while (c & 32); return (v & 1) ? -((v + 1) / 2) : v / 2; };
  const nA = rd(), out = new Array(nA);
  for (let a = 0; a < nA; a++) {
    const head = rd(), len = head >> 1, closed = !!(head & 1);
    const pts = new Array(len); let x = 0, y = 0;
    for (let i = 0; i < len; i++) { x += rd(); y += rd(); pts[i] = [x / Q, y / Q]; }
    pts.closed = closed;
    out[a] = pts;
  }
  return out;
}
const ARCS = decodeArcs('iDwDuc4+DApB1BVKnBhBDNnBkBDOfcCAxCdjBUR+BNAPoBV1BXHXhBfQpBVVlBERHexBvBZUtBPrBgBRHjBwCoa2nDfORHBjB3CIdTVIhBJhCOrBXzBENfGRbhBe5BnBlDhBDDRlBXCZwJsKo8CpCJxBpBXQAsB7BLOXlBNNRtBDZalBLjBQhBARVfAhBQasBYLEqBOSPyBnBwBRHdQB+BTkBpBRlBmBPDRjB9BONgBXOV1BbJtCRfEHNpCCPiBWQJiBSkBJ8B1BWQUR0BRbjBAdQLcdKb6BMoCVY7BQHMQuBzBAPoBxBmBKsBhBU0BqCnBqBNaSoBNuBGSlBcOQToBAYfKFU8B3kB0jED+BVAC8BTQJeOcaR4BgBUDuBWIJyByCWgEgBkBwH7dkyEgBRGhCOJqBQ0BXiBCINwBQgBAOQcNuC0BWdmBCyBdoBMiBtBkBMaqBkBnBwBTWE+BZgBdNRoCLiBduBsBoBbkBnBwBHkBYGY4BJKXqBMGOsCRkBaqBHYyBiBNiBBeLLZejBNlC4CnCS1BmBQKrBSTmBYQ1BBXaPyBLKbYUoDyN6XtCQ5BZCN5ClCnBDjBXVoBZCnC3CbzBbObHajBT1BYVK-BvCvBJQfNRSnBR1CBRJpC9CFzBsKpMoF7CM3DdPS3CURO5BLRSbPlCDVoB5BFOjBjB7BTEbqBrBxBhBevBCZRBkBXQjCvCzBrBHW3BgClBPVdtBOtBTPkBdFmBoC-BiBCmBRkBQKrBwBXMnCAFwBdBtC0BVuBOkBE4BWUbiCjBU7BsCA0B9B4BxBkCE2BN8B7BURkB5BFMjBYLAVrDA-BXFRtCiBvBbNMJ6BKoBHgBMoBLQbLbqBpBbjBeeeTmBZPXICW-BGXgC4H13CksBQqBNMWkBBsBM6BuBsCiBUCamBcPMAcUeBuBsBuCIoBXcQqBUKBwBgBGSXwBJSVqBRaOlBuCiBWclBeCIgBgDYQWaDiBWASjBeiBYMgBgBMyCiCYsBgBUR0CaegBBKmBeKHsBRiBOMKmBtBcG2BsBCAwBOwBiCABYzBebAnBuB8F98B8+CkBerBsCKoBb6BUeoDWoCoCDUQsBX2BWKAiBOgBtBYSU9C4BBgBdUKWJgCOQkBKQsBcH4BIGO4BEwBsBoBNYIE4BgBFIZ6CBaTgBQUL+BwBToBGcyBqBwBOSsBXsBOUsBE8GsKo8CkBRWCqBfW-CoBdShCULG3B1B9BPB7B3BBxBYLChBRBQ1BDVnBBjBPDPlBG9BNJ3BMV4BfIjBmBlBTNG1BmB1BTTtBOZTjBAJXsBtBuBrDN3BxB9CEpBiBRyCxCB7BejCUvCFpDsBbOpBN1BSvBfnCUzBCnBpB9CsVoa2nDOxBaYyBHmCrCCVYJAhBeNKZZbWRvB7BUPaUYLelCmBImBoBQdPbkBFiBpBCdUjBAdyBpBhBTMfeFYeQjBN7B6CLUUQVcDSgBiBDUZ6B2BsBTBoBYDFfWbaLcEQ4BuBFkCUkBRwBUoCGbwByBuBkBE+BZgBKSReHsBIGnBJVcPmBEWflBpBedUoBcCc1BCZcFQ3BcRFZpCrBOZUIa3BRlBGPkBLoBiBQzBsBdwBN0B2BDrBqBPgBnBAfQfwBwBsBGQZ2B6CBqBsBBmBW0BPmB0BUHOrBkDYHsBIoBQOFmBZAA6BSckBHOKDoBSSwBRuBgDUHWSHYQeUEBeUWYTVXSVSgBYCeiBSsBgDiBaZQ1CcCQViBJoBkByBDsBWoCZc5BYXmCUUwBuBUmBpBEPoDhC0BPIdkBZYQEhBQX0CRkBdsBNcfJfYtBbjBLxBYpBqBQYLYhCiBVD1BwG+3E8+BTNvBDtBOnBVS9B9BhBArBXADhBbRDZsBDwCSSQqBROZPb1BzB1BPQjCpCnCX9B7B7B-BjBCZZFZjBabPPnBTbvB7DxBXEhCrCmB7BD9BPfHxBcRhB3BhBLBPxBrB-BjB3F-F0BvBtB5BPtBXbQlBXnB8Ri2D+GjBvBvBpBrB1CZAHpBPERbdN9CIrBNNsChBCnBuBhBRVzBhBFZnBVJ1BAROSiCHMfNNmBbAfUCsBnBiBtBQWeLY7BItBYPgCfInBHfd1BN7BqBrCETpBAjBXpBD7BlBrCCrBrBtDdlEZHdKJYOcPSQS9BmBeqBValBEnBlBCZjBGfqBVnBjBFRiBhBM5BBNzBDlCbnBxBlBZALZbCAsBjBLRaZJEV7BEhBgBvCtB1BKLqB-BGZMUkCLeQiBmBKCcoBBEyCPuBUuBHMKwBtBmBpBKfXfSEcbMFWjBRlBebALQOaN+BTOTsCdUTuBNIJiC7BAanBXPbCKpBNRZMlBpBjBLJSIgBXQCexBEXlBVLjBINsBhBA7B1BTFlBWjB2BxBSlBgBT6BoGxnBi8FcPQWkBNHjBiCtBKXwBlBUnB2CzBOjBSJahEuBxCrBJETZLFjBZVOVgBeSdbNRpBMlBPZIvBQXDfWFdtBgBVWcSPPZCXdTZnBLnBIVoBrBO1BFXGfcrBNlBZYfKXHHxBsI98B8+CjBTrBcb+BrBsBfb7CKFajBiBHiB7BAZOXgBH6DMYZ2B5BmB1CHfRRGXrBjBBTnBhBDHlBrBBRazBXJEIyD5BHnBOTiDYS-B8BbAdVURXVJXxBaThBfLvCmBlBRbIbPVfzBD3BnBNkCnBbbKHRWVtBPVQCeTC-B8BlBHbchBKThBhBH5BsBJJwCr6DgxD9BYRDXWTBRWlCJJlBzBRTjBpBXvBMTmBpBIDgBjBgCQeXWGgBfsBwOzqE63DeGcVoBB8CuB1DoCTgCdKNaIwDfcUMY0CUOKkBRQGiDfiBL8CU0CFoDW6BdBPZnC2FNElB8BrBQNyBCyCReDgCdQBiBeQUeAsCL0BjBaxBSMeJSGgBcBgBfaOUHOjBsEjBOXoBCIXsDMmBQSsBOJmBS2BCmCZiBCFXgBtBGlCZGNdfNNlCyB-CyC5DGZTTQTsBTuByB+CK0BF0DhCqHnBwBIwEX2BV8BpBwCd6BGuCQmDoBsE2DgDiBwCEsBQAOjCIRLrEiBdeDgBPIGwB6CwFM8BegBgDsBmBIwBkBoCiB0E+CqEgB4CEsBUkDakBU6BH6CeoD6BkEyD0Be4PxnBi8FsCmCgBiDeuBmBWwBxBgBIwBZKOTwBpBEbwBBSrBIJkBOsDWMqBCeLPgBvBMXekBgHiBDpB8BAyDN6CkB4BMsBCyBbgDIe6BK6C+C0Ba8CeUDaSkEWWMqBBeY0BDCaaD+DoB2BL4E8BQlBMhDiBZYhCrBrBSJCxCatC0CAUxBsBxBGbabkBKWfcNYOQ+B2CyBoBMcJWgBqBR8BvDiBAOTEhBVhBQ3BOTSjEuCnBOR4BaqBqBwBRXlBaFwBKQPYK6BlCKlDPdS5BmBxBUQGwBKOsDCmBjBUB8BkBaBiBOMV2ClCEnB2CAOZffd3BJrBGVbpBoCAAnBgBvBHdtBZLGZtBWzBPNgBDaNARmBCkJo0Bs2FPjCoBRFpCZlBHrBMVRRgBVITRRDZhBRFb7BjBBrBdhBfMVLLXwBlCRdSTCVlBbC-BSbVTMzBLpCXBRejBBlBwBbVhBSbPSVHbpCNjBdrBH5BfOhBBtBSjBJxBmBFIlBWLaGBfxBXRSfHfCLXAbe5B1BjBApBgCOQFQhBNRbFR5BdHKZbJAbvBNtBhDsZo0Bs2FsCWsBbeCmCXkBSeBgC4BoDcW8CPYSqByBcKoBgCoBIJwBBQbXRApBRGV1CMPVjBChBbnBAT+BPqB5BlBvCSfJtCuCFaYsBBKb6BdcEajBMrBqBJCVsBEkBNYSkC-BVfEjBgBW0BNoBlBOhCYRPjBYdoCeQYmBLYKUecMoBTgBKqBeWRsBLCjBiBfqCGiBNO-BwEqBgByBoDOYJUjBSA2Bd4Ba2BP8CjCNbYTaDP-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-CDNvBX1BJkB-BHpBQHDvBKReJEnBLROVPX9BKRPhBEhBoBZDLXIff5BeVYIIVeVlB5BMLdzBzBFHdWLSdXjBzCiBAxBvBNTvBEPnBJXRNdxBmBDSbWdCNXfJ7BMdFVpB1BLPTbQjCjBnCcLSnBFbbFfbCEcrCPXlBQpBAdTZbG3B0BcSBapBoBNjBdV9BAvBXJMdfnBXsBdBxDnBBiBzD9BlBGbTVSNDbtBPCpBkBBExBmBMGPkBOOVuBIcHInBcTa1BLfQblBRFvBelBMkBUSejBTtCmBtBXfnBIZrBAZgBXjB7BfLCrC5BIjBxCdVXDCrBP-BdNnBKHtBZFHVI9C1BXUrCHfgTltD-qFJTfA1B3BTOpBRpCyBTTCTXJJXVKCmBbDJwBzBmBfwBXFdUJiBMQboCpBBbT-BCnBU3BJ7BqBFS5CafiBZRjBqBPD3BoBVTTGTcdMmBuCxBFdhBGPTxCjDiBhB6BCQkC2BCkBQOEeUUIiDhBiBdH-BeJQlCDGRZnBjBEV2BMYzBadBrBXbwChBOAkBgBAyEsBuBmB2FgJyGoZmD2QAgEmBsBgBqCAcQgBiBCYZkCNQI4BCFqBhB2B1DyDRbGT3B1BVtBL7BTPqFihBM0FMyBDuBagCsBuBMiBiBFUnBAlB2GhHkBxBkB9CWhF6BzFwCpDWqBvB2Bf2CAkC5BiKjC0EvBiC9EmECgBRWxDgCjEmDC4DmBUSJkCWX+BGeeJcWiBiCBkBQUjBkCoBEOaL+BZIHgCPQNoBvBWDWfJRiBesBCegBQiBeCQiBKPuCiBvkD7xEQACnBhBAGfoBLSgCXoBiB1kDz3EceRmBGYVQflBDVUvByCvuEfiBceAFlBoCBsBhBiBDQpBBVfD3BYlBkBpCsBxBJdOb6B4BeYHQhBrBNyCvnEzTN0BdkB9BsBlB2BFgBMgBZwCuBNBLmCjCiCFMNJlBOVFbuBhCX5BMhBrBpB4Q1U7iCUlBBhBgBjBXNItByBtCgBTB9BVzCGhBenBRRGnBqBjBCsBYSYDuBWqBEGdmBNSO8BTUQiBCWgCiC2BI2CmBYBsBQQJUYmBeEkB8BcAMkBQMeHSbA9CgBcOF0BIDlBarCQbeOSZPTQjBLZUvCsBzB2BoECgBUYA+BawBgBAFgBO2BoBauB-B+BoBHiBWKFcwBJ0CoCedUGMrBFRe7BGpBqBlCgBW+CEGwCkBIgBJUxBBV8BEYKKZ6B9BuBVHfeFKnDcrBA1BQRS1BeCmB7CIjCMVuBVMrBYTRpBC-BRNQTYQ+BSUnBmBIMb0C3BUSOcBkBmBOQaiBAYMSTLxBKVmBBSQIoC2BDuBbQZ6BTMTYIMTwFynC5lDGZYXEpBiBEAhBSJLlEalBgBBkBTAT6B5BGtBdEAhBnBxBtBVzB-B5BdcjBZVOtBBfXfRzBAZQlBnBDLOzBQ5BNLtBZHdpCQPoBBbnBbCRnB-BVhC1BhCZJ9BkUm5BzuErCSrBaLgBYmBrBiBzBEzBH3D5B-BxB-BpCxCnBAXpCPjC5BrDnExBIpBWzBJxBV3D9CpCrChD5E5BvFBvBWTX7FDjGQrGKViBTWCmBPPPMlBWFajC-BEpBTpBwBJchBJbMXNZaZlBnCIZHxB-BfJVWrBHxBZVXSrCnCIlBSbFRftBOVDRenBeCUlDcvBkBRHpBYLN1BT1BMfRPvBfNFPnCLrBMdwBB0BTIFoBVLlBGDQ7CyBvBDjBKFoBM0BWWmBOlCcOiB-BWZHbSjBDjCuB3BPZMLlBIVZTREVkBFuBfaEYpBYGYnBQ3BPdEbUtCZhBeDqBXcpBSnDKZerBXpC8BhCaRH7CsB5BjBMVAffhBoB3DNdlFaLRvBQxBNnBKJclBSnBbHjBhBLdiBFgBnBG5BgBRRbDfRXM1BdXKpBb5BSJmBlBI9B8DXRjCoBrBuBpBYS9ZpgGBbgCHfsBwOi2D+GmBJyC9BxB5CAdRPa1BXVPO7BPhBbZHNfgBPlB3CgBSkCBGSsBCoBP0BeKiB2BuBuBSiBuBDSrBNhBuBmB0DceuBGOZmBRWe+BYOgBgBWkBNiDWiDIqCTUTlBpBShB8CrCJvBNHlBnCMhBVhBIlBUN+CFNrBIRRzBSNoBmBeXoBjCYHUdBhBWFKxBZNRdEVNZtBPJVpCD7BRPhBKLHvBKzCwB3BiCTDRmBXiBMoBTVxCWVBlCSVFTyBJEd8BJU3BwClBRnBBhBZTBfXFMxBSXElBrCvCTY9CfLtB-BVLTMdxBRpBgBzBQdlBfKjBHFZvBZgQysEv5BPSrBAVddJVOfdI1BlBJPSxBDhBMKWNgBjBUjBPtBchBfS9BZFN1C4BX2BOYDFfQPCjBiBHCpEVLpBmBhBFTd9BIdHvBKRd7BtBfiBbdbDhBXiBTEPhCtBXGLPvBEVTb1BeJAXdTHfrBOdnB-CQEhCbrBV-BkBLsBzBnBBNtBNLjDmBpBBXnBIdoBPXbhBShBLe1BHhBeBKZcVgBUUX6CCHnBiBLFXSTiBGElEbDDlBoBDBZ3BGKajBgBlBBNbWTjBNJbvBbxBEX0B7BEBoChBUTR9CoBTZnCKXOGYN6BUQEcrCvBfGTmB9BjBbD1BlB9BB5B1BPGLyDxBgB-CJfQA-CmCmwC7gDXZcRPTKhBmBIiCPwBuCEccEDalBSDUbcdDxBXL1B4aysEv5BBNqBtBBdSvB8BCUHKbNLedJpDYBqBpBiClB6BFWc0CfQpBTlBepBChBYjBaFOxBTDnBQrBFdfJXSrBd3BAfTXpBPXhBQ1BUbeNGXeTCNxBRIpCJVqBNEXqBlBDVsBXUlCkBRkBQ0CtBUK0BfUXUIOXmBZkCMYrBiBOsBJEQiBAyBeyCUsBBgBuBuBBPhCIX0B1BNjCnBTKxBRnBvBhBPCXfNhCzBZRhBwBzDrBjBPbTOzBrBCNrBNPGZRLZfRPMtBJnBnCNSrBHTdL7DZSlBRLV9CHZTNdURHfNHJtBVLNZnBAEXlBCxBPTWlBdVjDhBHPjB7ClCEToBCWQaNQYYTjBtBKzB3BpChBmBpBCjC9BpBG-BNpBVHbIvBlBCTWxBWlBLnBCfPVdJtBKzBvBQSOJwB5BMzBPJaTOtCEXYXRWpBzBdPjBhBEdsBKwBvBOIW-BGJSbHb6BXMfBZnBlBStB6BXXhCUpDJZMIYaaHmBXUUwBxBmCfErBjBpBPxBGJH3EDXWGU5BqCJmBrBKrCrBPzBeVVrBZF5BatED3CUbUFaiBUHwBXUzBQ7BEpCRnGSiCy1CnpECpBRzBIrBoBCQLYjDuCCkD2CDyBXMhC1BzBqDrBCVJPkBSoqEviFoBwBWBTrBO+oE3jFRgBsBEaojExiFKhBvBb1BcQMcLmUu7Hx1GK5BLlBUzBA1DdXUdRlBRETf3BXMnBYkBeNcEX7BrBZTpBFnBOVhBtBjBXGnBeLhBhCtBFRcTBhBSjBBKsBJebDrBmBTJlBgB1CGLWhBFLevBgBVB7BkCQYCoBgBCiBeWAMkBoBaDM3CGjBYtBFKmBPI5BftBkByByBbiBmBEiBUOgBE6BPacOf0BtBJZV1BHlBEfPGqBdoBSemBBWSNyBmBgB6BaDiBXANyBhBSdFNYbA7ByBQORmBCcbwBgCgB0CUAYlBkBZBPQAqBPQdCffNWW4BqBKDyBSImBFQiDNaBiBkBUQAI0BoBaGRgBASUEwBsCcGaYASQsDO4BsBJYgB6BsBeyBMmBPYU+C7CgBoBDeYiBNmDjBsBSkCPuBcWK0BbuCUWgCE8BZJlBUjBwBlHRpBR7EoBrCmC3COjCB1BY-CFpCuB-EM7IvE7HIrBP1C');

function assemble(refs) {
  const pts = [];
  for (const ref of refs) {
    const a = ARCS[Math.abs(ref) - 1];
    const seq = a.closed ? a.concat([a[0]]) : a;
    if (ref > 0) { for (let i = pts.length ? 1 : 0; i < seq.length; i++) pts.push(seq[i]); }
    else { for (let i = seq.length - 1 - (pts.length ? 1 : 0); i >= 0; i--) pts.push(seq[i]); }
  }
  const f = pts[0], l = pts[pts.length - 1];
  if (pts.length > 1 && f[0] === l[0] && f[1] === l[1]) pts.pop();
  return pts;
}
const ringArea = pts => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; };
const ringBox = pts => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } return [x0, y0, x1, y1]; };

/* ---- regions ---- */
const RAW = [{"n":"Île-de-France","c":"11","p":[[[-5,-4,-3,-2,-1]]]},{"n":"Centre-Val de Loire","c":"24","p":[[[-10,3,-9,-8,-7,-6]]]},{"n":"Bourgogne-Franche-Comté","c":"27","p":[[[-13,-12,-11,2,10]]]},{"n":"Normandie","c":"28","p":[[[-17,-16,-15,9,4,-14]]]},{"n":"Hauts-de-France","c":"32","p":[[[-19,-18,14,5]]]},{"n":"Grand Est","c":"44","p":[[[19,1,11,-20]]]},{"n":"Pays de la Loire","c":"52","p":[[[-23,-22,8,15,-21]],[[-24]],[[-25]]]},{"n":"Bretagne","c":"53","p":[[[-26,21,16]],[[-27]],[[-28]],[[-29]]]},{"n":"Nouvelle-Aquitaine","c":"75","p":[[[7,22,-32,-31,-30],[-33],[-34]],[[-35]],[[-36]]]},{"n":"Occitanie","c":"76","p":[[[-39,-38,-37,31],[-40]],[[34]],[[33]]]},{"n":"Auvergne-Rhône-Alpes","c":"84","p":[[[13,6,30,37,-42,-41],[-43]]]},{"n":"Provence-Alpes-Côte d'Azur","c":"93","p":[[[-44,42,38],[-45]],[[-46]],[[-47]],[[-48]],[[43]]]},{"n":"Corse","c":"94","p":[[[-49]]]}];
export const REGIONS = RAW.map(r => {
  const rings = [], polygons = [];
  for (const poly of r.p) {
    const built = poly.map((refs, k) => { const pts = assemble(refs); return { pts, hole: k > 0, area: ringArea(pts), bbox: ringBox(pts) }; });
    built.forEach(b => rings.push(b));
    polygons.push({ outer: built[0], holes: built.slice(1) });
  }
  let A = 0, cx = 0, cy = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const ring of rings) {
    const pts = ring.pts;
    let a = 0, mx = 0, my = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const cr = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      a += cr; mx += (pts[j][0] + pts[i][0]) * cr; my += (pts[j][1] + pts[i][1]) * cr;
    }
    a /= 2; A += a; cx += mx / 6; cy += my / 6;
    if (!ring.hole) { const b = ring.bbox; if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3]; }
  }
  return { nom: r.n, code: r.c, rings, polygons, centroid: [cx / A, cy / A], bbox: [x0, y0, x1, y1], area: A };
});

/* ---- reperage : dans quelle region tombe un point du monde ? ---- */
function inRing(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    if ((b[1] > y) !== (a[1] > y) && x < (a[0] - b[0]) * (y - b[1]) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}
/** Region contenant le point monde (x, y), ou null si en mer / hors territoire. */
export function regionAt(x, y) {
  for (const reg of REGIONS) {
    const b = reg.bbox; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    for (const p of reg.polygons) {
      const q = p.outer.bbox; if (x < q[0] || x > q[2] || y < q[1] || y > q[3]) continue;
      if (inRing(p.outer.pts, x, y) && !p.holes.some(h => inRing(h.pts, x, y))) return reg;
    }
  }
  return null;
}
/** true si le point monde (x, y) est sur le territoire (utile pour mailler un relief clippe). */
export function contains(x, y) { return regionAt(x, y) !== null; }

/* ---- contour exterieur et frontieres internes ---- */
export const OUTLINE = [[12,41,44,39,32,23,26,17,18,20],[49],[36],[45],[35],[29],[25],[24],[28],[48],[27],[40],[46],[47]].map(assemble);
export const BORDERS = [[10,6,7,8,9],[19,1,2,3,4,5],[30,31],[37,38],[11],[13],[42],[15,16],[22],[21],[14],[43],[33],[34]].map(assemble);
export const OUTLINE_SEGMENTS = (() => {
  const out = [];
  for (const line of OUTLINE) for (let i = 0; i < line.length; i++) { const a = line[i], b = line[(i + 1) % line.length]; out.push(a[0], a[1], b[0], b[1]); }
  return out;
})();

/* ---- relief ---- */

/* --- bruit de valeur deterministe (aucune dependance, aucune table) --- */
function hash2(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  let u = x - i, v = y - j;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  const t = a + (b - a) * u, w = c + (d - c) * u;
  return t + (w - t) * v;
}
/** fBm normalise dans [0, 1]. */
function fbm(x, y, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let k = 0; k < oct; k++) { s += a * vnoise(x * f, y * f); n += a; f *= 2.03; a *= 0.5; }
  return s / n;
}
/** Somme en p-norme (p = 4) des capsules de crete : une chaine reste continue. */
function ridgeField(M, x, y) {
  let s = 0;
  for (let m = 0; m < M.length; m++) {
    const b = M[m].b;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    const P = M[m].p;
    for (let i = 0; i + 1 < P.length; i++) {
      const A = P[i], B = P[i + 1];
      const ex = B.x - A.x, ey = B.y - A.y, L2 = ex * ex + ey * ey;
      let t = L2 > 1e-12 ? ((x - A.x) * ex + (y - A.y) * ey) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (A.x + ex * t), dy = y - (A.y + ey * t);
      const r = A.r + (B.r - A.r) * t, d2 = dx * dx + dy * dy, r2 = r * r;
      if (d2 >= r2) continue;
      const u = 1 - d2 / r2, w = u * u * (A.h + (B.h - A.h) * t);
      const w2 = w * w; s += w2 * w2;
    }
  }
  return s > 0 ? Math.sqrt(Math.sqrt(s)) : 0;
}

export const RELIEF = {
  max: 0.04, gain: 0.036119, ratio: 0.932869, altRef: 4810, kmPerUnit: 568.730808,
  massifs: [
  { n: "Pyrenees / crete", t: 'c', b: [-0.63827, -0.78375, 0.07277, -0.52178], p: [
    { lat: 43.38, lon: -1.6, rayon: 19, hauteur: 900, x: -0.60486, y: -0.55519, r: 0.03341, h: 0.18711 },
    { lat: 43.16, lon: -1.25, rayon: 24, hauteur: 1500, x: -0.5575, y: -0.60095, r: 0.0422, h: 0.31185 },
    { lat: 43.06, lon: -0.95, rayon: 26, hauteur: 1800, x: -0.51571, y: -0.62271, r: 0.04572, h: 0.37422 },
    { lat: 43.01, lon: -0.68, rayon: 26, hauteur: 2100, x: -0.47761, y: -0.63435, r: 0.04572, h: 0.43659 },
    { lat: 42.96, lon: -0.45, rayon: 28, hauteur: 2500, x: -0.44516, y: -0.64561, r: 0.04923, h: 0.51975 },
    { lat: 42.92, lon: -0.25, rayon: 28, hauteur: 2884, x: -0.41687, y: -0.65465, r: 0.04923, h: 0.59958 },
    { lat: 42.83, lon: -0.1, rayon: 31, hauteur: 3298, x: -0.39608, y: -0.67311, r: 0.05451, h: 0.68565 },
    { lat: 42.74, lon: 0.08, rayon: 31, hauteur: 3355, x: -0.37091, y: -0.6917, r: 0.05451, h: 0.69751 },
    { lat: 42.81, lon: 0.3, rayon: 31, hauteur: 3091, x: -0.33884, y: -0.67913, r: 0.05451, h: 0.64262 },
    { lat: 42.76, lon: 0.55, rayon: 31, hauteur: 3222, x: -0.30326, y: -0.69009, r: 0.05451, h: 0.66985 },
    { lat: 42.72, lon: 0.75, rayon: 31, hauteur: 3404, x: -0.27475, y: -0.69877, r: 0.05451, h: 0.70769 },
    { lat: 42.78, lon: 1, rayon: 28, hauteur: 2900, x: -0.23852, y: -0.688, r: 0.04923, h: 0.60291 },
    { lat: 42.84, lon: 1.25, rayon: 28, hauteur: 2838, x: -0.20235, y: -0.67711, r: 0.04923, h: 0.59002 },
    { lat: 42.78, lon: 1.5, rayon: 28, hauteur: 2900, x: -0.1667, y: -0.68959, r: 0.04923, h: 0.60291 },
    { lat: 42.68, lon: 1.75, rayon: 28, hauteur: 2921, x: -0.1311, y: -0.70979, r: 0.04923, h: 0.60728 },
    { lat: 42.61, lon: 2, rayon: 28, hauteur: 2910, x: -0.0953, y: -0.724, r: 0.04923, h: 0.60499 },
    { lat: 42.54, lon: 2.2, rayon: 26, hauteur: 2784, x: -0.06663, y: -0.73803, r: 0.04572, h: 0.57879 },
    { lat: 42.56, lon: 2.46, rayon: 24, hauteur: 2784, x: -0.02909, y: -0.73444, r: 0.0422, h: 0.57879 },
    { lat: 42.54, lon: 2.75, rayon: 19, hauteur: 1250, x: 0.01271, y: -0.73856, r: 0.03341, h: 0.25988 },
    { lat: 42.47, lon: 3.02, rayon: 12, hauteur: 300, x: 0.05167, y: -0.75232, r: 0.0211, h: 0.06237 }
  ] },
  { n: "Pic du Midi de Bigorre", t: 'c', b: [-0.389, -0.68916, -0.32443, -0.62477], p: [
    { lat: 42.94, lon: 0.14, rayon: 16, hauteur: 2877, x: -0.36087, y: -0.6529, r: 0.02813, h: 0.59813 },
    { lat: 42.9, lon: 0.2, rayon: 16, hauteur: 2600, x: -0.35256, y: -0.66103, r: 0.02813, h: 0.54054 }
  ] },
  { n: "Pyrenees / piemont", t: 's', b: [-0.6609, -0.75549, 0.08324, -0.49604], p: [
    { lat: 43.2, lon: -1.3, rayon: 55, hauteur: 700, x: -0.56419, y: -0.59275, r: 0.09671, h: 0.14553 },
    { lat: 43.15, lon: -0.6, rayon: 55, hauteur: 800, x: -0.46493, y: -0.60751, r: 0.09671, h: 0.16632 },
    { lat: 43.1, lon: 0.1, rayon: 55, hauteur: 900, x: -0.36545, y: -0.6214, r: 0.09671, h: 0.18711 },
    { lat: 43.05, lon: 0.8, rayon: 55, hauteur: 900, x: -0.26577, y: -0.63441, r: 0.09671, h: 0.18711 },
    { lat: 43, lon: 1.5, rayon: 55, hauteur: 850, x: -0.16589, y: -0.64654, r: 0.09671, h: 0.17672 },
    { lat: 42.9, lon: 2.2, rayon: 50, hauteur: 800, x: -0.06591, y: -0.66757, r: 0.08792, h: 0.16632 },
    { lat: 42.85, lon: 2.75, rayon: 40, hauteur: 600, x: 0.01291, y: -0.67788, r: 0.07033, h: 0.12474 }
  ] },
  { n: "Plateau de Lannemezan", t: 's', b: [-0.40323, -0.66046, -0.25509, -0.54961], p: [
    { lat: 43.2, lon: 0.2, rayon: 30, hauteur: 600, x: -0.35048, y: -0.60236, r: 0.05275, h: 0.12474 },
    { lat: 43.18, lon: 0.5, rayon: 30, hauteur: 550, x: -0.30784, y: -0.60771, r: 0.05275, h: 0.11435 }
  ] },
  { n: "Corbieres", t: 'c', b: [-0.06497, -0.69976, 0.05176, -0.59357], p: [
    { lat: 43.1, lon: 2.45, rayon: 20, hauteur: 600, x: -0.0298, y: -0.62874, r: 0.03517, h: 0.12474 },
    { lat: 42.98, lon: 2.6, rayon: 20, hauteur: 900, x: -0.00849, y: -0.65235, r: 0.03517, h: 0.18711 },
    { lat: 42.9, lon: 2.8, rayon: 18, hauteur: 700, x: 0.02011, y: -0.66811, r: 0.03165, h: 0.14553 }
  ] },
  { n: "Alpes / crete", t: 'c', b: [0.46808, -0.50682, 0.70178, 0.04921], p: [
    { lat: 46.3, lon: 6.8, rayon: 23, hauteur: 2200, x: 0.56139, y: 0.00877, r: 0.04044, h: 0.45738 },
    { lat: 46.1, lon: 6.85, rayon: 23, hauteur: 2500, x: 0.57003, y: -0.02993, r: 0.04044, h: 0.51975 },
    { lat: 45.92, lon: 6.9, rayon: 25, hauteur: 3200, x: 0.57853, y: -0.06471, r: 0.04396, h: 0.66528 },
    { lat: 45.83, lon: 6.87, rayon: 27, hauteur: 4400, x: 0.57532, y: -0.08247, r: 0.04747, h: 0.91476 },
    { lat: 45.6, lon: 6.9, rayon: 27, hauteur: 3600, x: 0.58162, y: -0.12715, r: 0.04747, h: 0.74844 },
    { lat: 45.4, lon: 6.95, rayon: 29, hauteur: 3800, x: 0.5904, y: -0.16583, r: 0.05099, h: 0.79002 },
    { lat: 45.2, lon: 6.9, rayon: 29, hauteur: 3600, x: 0.58548, y: -0.2052, r: 0.05099, h: 0.74844 },
    { lat: 45.05, lon: 6.7, rayon: 29, hauteur: 3500, x: 0.55935, y: -0.2358, r: 0.05099, h: 0.72765 },
    { lat: 44.92, lon: 6.4, rayon: 29, hauteur: 4102, x: 0.51907, y: -0.26304, r: 0.05099, h: 0.85281 },
    { lat: 44.8, lon: 6.75, rayon: 27, hauteur: 3300, x: 0.56856, y: -0.28427, r: 0.04747, h: 0.68607 },
    { lat: 44.6, lon: 6.85, rayon: 27, hauteur: 3400, x: 0.58432, y: -0.32264, r: 0.04747, h: 0.70686 },
    { lat: 44.4, lon: 6.85, rayon: 27, hauteur: 3300, x: 0.58622, y: -0.36168, r: 0.04747, h: 0.68607 },
    { lat: 44.2, lon: 7.1, rayon: 27, hauteur: 3143, x: 0.62312, y: -0.39897, r: 0.04747, h: 0.65343 },
    { lat: 44.05, lon: 7.3, rayon: 25, hauteur: 2900, x: 0.65271, y: -0.42676, r: 0.04396, h: 0.60291 },
    { lat: 43.9, lon: 7.35, rayon: 23, hauteur: 2200, x: 0.66134, y: -0.45566, r: 0.04044, h: 0.45738 },
    { lat: 43.78, lon: 7.4, rayon: 16, hauteur: 1100, x: 0.66968, y: -0.47869, r: 0.02813, h: 0.22869 }
  ] },
  { n: "Prealpes", t: 'c', b: [0.33327, -0.54302, 0.55434, 0.00245], p: [
    { lat: 46.1, lon: 6.4, rayon: 20, hauteur: 2200, x: 0.50915, y: -0.03272, r: 0.03517, h: 0.45738 },
    { lat: 45.95, lon: 6.45, rayon: 20, hauteur: 2750, x: 0.51719, y: -0.0617, r: 0.03517, h: 0.57173 },
    { lat: 45.75, lon: 6.25, rayon: 20, hauteur: 2200, x: 0.49166, y: -0.10189, r: 0.03517, h: 0.45738 },
    { lat: 45.55, lon: 6.05, rayon: 20, hauteur: 2000, x: 0.46593, y: -0.14202, r: 0.03517, h: 0.4158 },
    { lat: 45.35, lon: 5.9, rayon: 20, hauteur: 2080, x: 0.44686, y: -0.18184, r: 0.03517, h: 0.43243 },
    { lat: 45.22, lon: 6.05, rayon: 20, hauteur: 2977, x: 0.46842, y: -0.20644, r: 0.03517, h: 0.61892 },
    { lat: 45.05, lon: 5.75, rayon: 20, hauteur: 2000, x: 0.42832, y: -0.24115, r: 0.03517, h: 0.4158 },
    { lat: 44.95, lon: 5.45, rayon: 22, hauteur: 2340, x: 0.38753, y: -0.26204, r: 0.03868, h: 0.48649 },
    { lat: 44.75, lon: 5.75, rayon: 22, hauteur: 2790, x: 0.43036, y: -0.29974, r: 0.03868, h: 0.58004 },
    { lat: 44.55, lon: 5.55, rayon: 22, hauteur: 1900, x: 0.40388, y: -0.33973, r: 0.03868, h: 0.39501 },
    { lat: 44.35, lon: 5.4, rayon: 22, hauteur: 1750, x: 0.38419, y: -0.37946, r: 0.03868, h: 0.36383 },
    { lat: 44.17, lon: 5.28, rayon: 20, hauteur: 1912, x: 0.36844, y: -0.41513, r: 0.03517, h: 0.39751 },
    { lat: 44.1, lon: 5.75, rayon: 20, hauteur: 1826, x: 0.43478, y: -0.42671, r: 0.03517, h: 0.37963 },
    { lat: 43.95, lon: 6.1, rayon: 20, hauteur: 1700, x: 0.48504, y: -0.45419, r: 0.03517, h: 0.35343 },
    { lat: 43.82, lon: 6.3, rayon: 20, hauteur: 1600, x: 0.51423, y: -0.47845, r: 0.03517, h: 0.33264 },
    { lat: 43.65, lon: 6.35, rayon: 18, hauteur: 1300, x: 0.52269, y: -0.51137, r: 0.03165, h: 0.27027 }
  ] },
  { n: "Alpes / socle", t: 's', b: [0.34435, -0.6017, 0.66787, 0.09095], p: [
    { lat: 46.1, lon: 6.5, rayon: 70, hauteur: 900, x: 0.52268, y: -0.03213, r: 0.12308, h: 0.18711 },
    { lat: 45.6, lon: 6.3, rayon: 75, hauteur: 1200, x: 0.4997, y: -0.13088, r: 0.13187, h: 0.24948 },
    { lat: 45.1, lon: 6.1, rayon: 75, hauteur: 1200, x: 0.47622, y: -0.2296, r: 0.13187, h: 0.24948 },
    { lat: 44.6, lon: 6.3, rayon: 70, hauteur: 1100, x: 0.50786, y: -0.3261, r: 0.12308, h: 0.22869 },
    { lat: 44.15, lon: 6.6, rayon: 65, hauteur: 900, x: 0.55358, y: -0.41215, r: 0.11429, h: 0.18711 },
    { lat: 43.8, lon: 6.6, rayon: 55, hauteur: 600, x: 0.55669, y: -0.48051, r: 0.09671, h: 0.12474 },
    { lat: 43.6, lon: 6.1, rayon: 45, hauteur: 400, x: 0.48772, y: -0.52258, r: 0.07912, h: 0.08316 }
  ] },
  { n: "Jura / crete", t: 'c', b: [0.35816, -0.14702, 0.61552, 0.26058], p: [
    { lat: 45.7, lon: 5.5, rayon: 18, hauteur: 900, x: 0.38981, y: -0.11537, r: 0.03165, h: 0.18711 },
    { lat: 45.95, lon: 5.6, rayon: 20, hauteur: 1300, x: 0.40184, y: -0.06612, r: 0.03517, h: 0.27027 },
    { lat: 46.15, lon: 5.75, rayon: 20, hauteur: 1531, x: 0.42084, y: -0.02639, r: 0.03517, h: 0.3183 },
    { lat: 46.32, lon: 5.98, rayon: 22, hauteur: 1720, x: 0.45069, y: 0.00792, r: 0.03868, h: 0.35759 },
    { lat: 46.55, lon: 6.1, rayon: 22, hauteur: 1495, x: 0.4651, y: 0.05344, r: 0.03868, h: 0.31081 },
    { lat: 46.78, lon: 6.25, rayon: 22, hauteur: 1463, x: 0.48338, y: 0.09913, r: 0.03868, h: 0.30416 },
    { lat: 47, lon: 6.45, rayon: 22, hauteur: 1420, x: 0.50824, y: 0.1432, r: 0.03868, h: 0.29522 },
    { lat: 47.25, lon: 6.8, rayon: 22, hauteur: 1250, x: 0.55246, y: 0.19412, r: 0.03868, h: 0.25988 },
    { lat: 47.42, lon: 7.05, rayon: 18, hauteur: 830, x: 0.58387, y: 0.22893, r: 0.03165, h: 0.17256 }
  ] },
  { n: "Jura / socle", t: 's', b: [0.31624, -0.15523, 0.63773, 0.28331], p: [
    { lat: 45.9, lon: 5.55, rayon: 45, hauteur: 450, x: 0.39536, y: -0.07611, r: 0.07912, h: 0.09356 },
    { lat: 46.35, lon: 5.95, rayon: 50, hauteur: 650, x: 0.44642, y: 0.01363, r: 0.08792, h: 0.13514 },
    { lat: 46.85, lon: 6.35, rayon: 50, hauteur: 650, x: 0.49617, y: 0.11335, r: 0.08792, h: 0.13514 },
    { lat: 47.3, lon: 6.85, rayon: 45, hauteur: 500, x: 0.55861, y: 0.20419, r: 0.07912, h: 0.10395 }
  ] },
  { n: "Vosges / crete", t: 'c', b: [0.50715, 0.24927, 0.66604, 0.57904], p: [
    { lat: 47.68, lon: 6.7, rayon: 16, hauteur: 800, x: 0.53528, y: 0.2774, r: 0.02813, h: 0.16632 },
    { lat: 47.82, lon: 6.87, rayon: 18, hauteur: 1247, x: 0.55628, y: 0.30579, r: 0.03165, h: 0.25925 },
    { lat: 47.9, lon: 7.05, rayon: 20, hauteur: 1424, x: 0.57906, y: 0.32258, r: 0.03517, h: 0.29605 },
    { lat: 48.03, lon: 7, rayon: 20, hauteur: 1363, x: 0.57123, y: 0.34762, r: 0.03517, h: 0.28337 },
    { lat: 48.2, lon: 7.05, rayon: 20, hauteur: 1200, x: 0.57606, y: 0.38113, r: 0.03517, h: 0.24948 },
    { lat: 48.4, lon: 7.22, rayon: 20, hauteur: 1099, x: 0.59608, y: 0.42131, r: 0.03517, h: 0.22848 },
    { lat: 48.65, lon: 7.2, rayon: 18, hauteur: 800, x: 0.59089, y: 0.46997, r: 0.03165, h: 0.16632 },
    { lat: 48.9, lon: 7.4, rayon: 18, hauteur: 580, x: 0.61396, y: 0.52017, r: 0.03165, h: 0.12058 },
    { lat: 49.05, lon: 7.6, rayon: 16, hauteur: 450, x: 0.63791, y: 0.55091, r: 0.02813, h: 0.09356 }
  ] },
  { n: "Vosges / socle", t: 's', b: [0.47297, 0.23735, 0.68312, 0.59359], p: [
    { lat: 47.85, lon: 6.8, rayon: 42, hauteur: 450, x: 0.54682, y: 0.3112, r: 0.07385, h: 0.09356 },
    { lat: 48.2, lon: 7, rayon: 42, hauteur: 450, x: 0.56955, y: 0.38079, r: 0.07385, h: 0.09356 },
    { lat: 48.6, lon: 7.2, rayon: 40, hauteur: 380, x: 0.59141, y: 0.46021, r: 0.07033, h: 0.079 },
    { lat: 48.95, lon: 7.45, rayon: 36, hauteur: 280, x: 0.61982, y: 0.53029, r: 0.0633, h: 0.05821 }
  ] },
  { n: "Massif central / socle", t: 's', b: [-0.13019, -0.60772, 0.2383, 0.0786], p: [
    { lat: 46, lon: 3.35, rayon: 80, hauteur: 550, x: 0.09627, y: -0.06206, r: 0.14066, h: 0.11435 },
    { lat: 45.7, lon: 3.15, rayon: 85, hauteur: 750, x: 0.06924, y: -0.12075, r: 0.14946, h: 0.15593 },
    { lat: 45.35, lon: 2.95, rayon: 90, hauteur: 880, x: 0.04191, y: -0.18914, r: 0.15825, h: 0.18295 },
    { lat: 45.02, lon: 2.85, rayon: 90, hauteur: 900, x: 0.02806, y: -0.2536, r: 0.15825, h: 0.18711 },
    { lat: 44.72, lon: 3.05, rayon: 85, hauteur: 900, x: 0.05572, y: -0.31224, r: 0.14946, h: 0.18711 },
    { lat: 44.42, lon: 3.35, rayon: 80, hauteur: 850, x: 0.09764, y: -0.37077, r: 0.14066, h: 0.17672 },
    { lat: 44.1, lon: 3.3, rayon: 72, hauteur: 700, x: 0.0909, y: -0.43335, r: 0.1266, h: 0.14553 },
    { lat: 43.82, lon: 2.85, rayon: 68, hauteur: 580, x: 0.02762, y: -0.48816, r: 0.11956, h: 0.12058 }
  ] },
  { n: "Limousin / socle", t: 's', b: [-0.24512, -0.37034, 0.04397, 0.05238], p: [
    { lat: 45.95, lon: 1.8, rayon: 70, hauteur: 450, x: -0.11419, y: -0.0707, r: 0.12308, h: 0.09356 },
    { lat: 45.6, lon: 2, rayon: 75, hauteur: 650, x: -0.0879, y: -0.13944, r: 0.13187, h: 0.13514 },
    { lat: 45.25, lon: 2.05, rayon: 70, hauteur: 600, x: -0.08189, y: -0.2079, r: 0.12308, h: 0.12474 },
    { lat: 45, lon: 1.7, rayon: 65, hauteur: 450, x: -0.13083, y: -0.25605, r: 0.11429, h: 0.09356 }
  ] },
  { n: "Forez-Vivarais / socle", t: 's', b: [0.07971, -0.47052, 0.32007, 0.04517], p: [
    { lat: 46.05, lon: 4, rayon: 55, hauteur: 500, x: 0.18434, y: -0.05154, r: 0.09671, h: 0.10395 },
    { lat: 45.7, lon: 4, rayon: 60, hauteur: 700, x: 0.18521, y: -0.11991, r: 0.1055, h: 0.14553 },
    { lat: 45.35, lon: 4.2, rayon: 60, hauteur: 700, x: 0.21353, y: -0.18789, r: 0.1055, h: 0.14553 },
    { lat: 45, lon: 4.2, rayon: 60, hauteur: 750, x: 0.21457, y: -0.25627, r: 0.1055, h: 0.15593 },
    { lat: 44.7, lon: 4.15, rayon: 58, hauteur: 700, x: 0.20852, y: -0.31499, r: 0.10198, h: 0.14553 },
    { lat: 44.4, lon: 4.05, rayon: 55, hauteur: 600, x: 0.19541, y: -0.37381, r: 0.09671, h: 0.12474 }
  ] },
  { n: "Puys-Dore-Cantal-Aubrac", t: 'c', b: [-0.02302, -0.3908, 0.0874, -0.05357], p: [
    { lat: 45.9, lon: 2.95, rayon: 16, hauteur: 1100, x: 0.04198, y: -0.0817, r: 0.02813, h: 0.22869 },
    { lat: 45.77, lon: 2.97, rayon: 16, hauteur: 1465, x: 0.04469, y: -0.1071, r: 0.02813, h: 0.30457 },
    { lat: 45.57, lon: 2.82, rayon: 20, hauteur: 1886, x: 0.02416, y: -0.14614, r: 0.03517, h: 0.3921 },
    { lat: 45.32, lon: 2.92, rayon: 20, hauteur: 1551, x: 0.03779, y: -0.195, r: 0.03517, h: 0.32245 },
    { lat: 45.06, lon: 2.76, rayon: 22, hauteur: 1855, x: 0.01566, y: -0.24576, r: 0.03868, h: 0.38565 },
    { lat: 44.85, lon: 2.85, rayon: 20, hauteur: 1450, x: 0.028, y: -0.28682, r: 0.03517, h: 0.30146 },
    { lat: 44.63, lon: 2.98, rayon: 20, hauteur: 1469, x: 0.046, y: -0.32983, r: 0.03517, h: 0.30541 },
    { lat: 44.48, lon: 3.05, rayon: 18, hauteur: 1200, x: 0.05575, y: -0.35915, r: 0.03165, h: 0.24948 }
  ] },
  { n: "Margeride-Lozere-Aigoual", t: 'c', b: [0.0664, -0.4943, 0.18586, -0.22218], p: [
    { lat: 45, lon: 3.45, rayon: 20, hauteur: 1400, x: 0.11095, y: -0.25735, r: 0.03517, h: 0.29106 },
    { lat: 44.75, lon: 3.5, rayon: 20, hauteur: 1551, x: 0.11817, y: -0.30616, r: 0.03517, h: 0.32245 },
    { lat: 44.52, lon: 3.65, rayon: 20, hauteur: 1450, x: 0.13936, y: -0.35096, r: 0.03517, h: 0.30146 },
    { lat: 44.42, lon: 3.73, rayon: 20, hauteur: 1699, x: 0.15069, y: -0.37041, r: 0.03517, h: 0.35322 },
    { lat: 44.22, lon: 3.6, rayon: 20, hauteur: 1567, x: 0.13284, y: -0.40965, r: 0.03517, h: 0.32578 },
    { lat: 44.1, lon: 3.58, rayon: 18, hauteur: 1500, x: 0.13021, y: -0.43313, r: 0.03165, h: 0.31185 },
    { lat: 43.95, lon: 3.35, rayon: 18, hauteur: 900, x: 0.09805, y: -0.46265, r: 0.03165, h: 0.18711 }
  ] },
  { n: "Forez-Livradois-Madeleine", t: 'c', b: [0.1031, -0.22673, 0.20333, -0.01037], p: [
    { lat: 46.1, lon: 3.85, rayon: 18, hauteur: 1165, x: 0.1639, y: -0.04202, r: 0.03165, h: 0.2422 },
    { lat: 45.88, lon: 3.88, rayon: 18, hauteur: 1250, x: 0.16845, y: -0.08494, r: 0.03165, h: 0.25988 },
    { lat: 45.65, lon: 3.9, rayon: 18, hauteur: 1634, x: 0.17168, y: -0.12984, r: 0.03165, h: 0.33971 },
    { lat: 45.45, lon: 3.72, rayon: 18, hauteur: 1250, x: 0.14746, y: -0.16916, r: 0.03165, h: 0.25988 },
    { lat: 45.3, lon: 3.6, rayon: 16, hauteur: 1100, x: 0.13123, y: -0.1986, r: 0.02813, h: 0.22869 }
  ] },
  { n: "Pilat-Mezenc-Vivarais", t: 'c', b: [0.1539, -0.45098, 0.29355, -0.14517], p: [
    { lat: 45.42, lon: 4.58, rayon: 16, hauteur: 1432, x: 0.26542, y: -0.1733, r: 0.02813, h: 0.29771 },
    { lat: 45.2, lon: 4.45, rayon: 16, hauteur: 1350, x: 0.24839, y: -0.21662, r: 0.02813, h: 0.28067 },
    { lat: 44.92, lon: 4.3, rayon: 18, hauteur: 1551, x: 0.22864, y: -0.27168, r: 0.03165, h: 0.32245 },
    { lat: 44.83, lon: 4.22, rayon: 18, hauteur: 1754, x: 0.21785, y: -0.28944, r: 0.03165, h: 0.36466 },
    { lat: 44.6, lon: 4.15, rayon: 18, hauteur: 1500, x: 0.2088, y: -0.33453, r: 0.03165, h: 0.31185 },
    { lat: 44.35, lon: 4, rayon: 18, hauteur: 1400, x: 0.18855, y: -0.38367, r: 0.03165, h: 0.29106 },
    { lat: 44.15, lon: 3.95, rayon: 16, hauteur: 1300, x: 0.18203, y: -0.42285, r: 0.02813, h: 0.27027 }
  ] },
  { n: "Beaujolais-Charolais", t: 'c', b: [0.19256, -0.14696, 0.29112, 0.02952], p: [
    { lat: 46.3, lon: 4.3, rayon: 18, hauteur: 700, x: 0.22421, y: -0.00213, r: 0.03165, h: 0.14553 },
    { lat: 46.1, lon: 4.45, rayon: 18, hauteur: 900, x: 0.24516, y: -0.04083, r: 0.03165, h: 0.18711 },
    { lat: 45.9, lon: 4.55, rayon: 18, hauteur: 1012, x: 0.25947, y: -0.07963, r: 0.03165, h: 0.2104 },
    { lat: 45.7, lon: 4.5, rayon: 16, hauteur: 900, x: 0.25342, y: -0.11883, r: 0.02813, h: 0.18711 }
  ] },
  { n: "Lacaune-Espinouse-Montagne Noire", t: 'c', b: [-0.08604, -0.60772, 0.07335, -0.41145], p: [
    { lat: 44.05, lon: 2.65, rayon: 18, hauteur: 900, x: -0.0004, y: -0.4431, r: 0.03165, h: 0.18711 },
    { lat: 43.85, lon: 2.75, rayon: 18, hauteur: 1100, x: 0.01353, y: -0.48225, r: 0.03165, h: 0.22869 },
    { lat: 43.68, lon: 2.72, rayon: 18, hauteur: 1267, x: 0.00918, y: -0.51548, r: 0.03165, h: 0.26341 },
    { lat: 43.62, lon: 2.95, rayon: 18, hauteur: 1124, x: 0.0417, y: -0.52728, r: 0.03165, h: 0.23368 },
    { lat: 43.45, lon: 2.45, rayon: 18, hauteur: 1211, x: -0.02932, y: -0.56027, r: 0.03165, h: 0.25177 },
    { lat: 43.35, lon: 2.25, rayon: 16, hauteur: 900, x: -0.05791, y: -0.57959, r: 0.02813, h: 0.18711 }
  ] },
  { n: "Causses-Larzac", t: 's', b: [0.01007, -0.52091, 0.12976, -0.36816], p: [
    { lat: 44.2, lon: 3.05, rayon: 26, hauteur: 900, x: 0.05579, y: -0.41388, r: 0.04572, h: 0.18711 },
    { lat: 44, lon: 3.2, rayon: 26, hauteur: 850, x: 0.07691, y: -0.45294, r: 0.04572, h: 0.17672 },
    { lat: 43.85, lon: 3.3, rayon: 22, hauteur: 700, x: 0.09108, y: -0.48223, r: 0.03868, h: 0.14553 }
  ] },
  { n: "Millevaches", t: 'c', b: [-0.13302, -0.20986, -0.04239, -0.07137], p: [
    { lat: 45.75, lon: 1.95, rayon: 22, hauteur: 800, x: -0.09434, y: -0.11005, r: 0.03868, h: 0.16632 },
    { lat: 45.6, lon: 2.05, rayon: 22, hauteur: 977, x: -0.08107, y: -0.13953, r: 0.03868, h: 0.20312 },
    { lat: 45.42, lon: 2.05, rayon: 20, hauteur: 850, x: -0.08149, y: -0.17469, r: 0.03517, h: 0.17672 }
  ] },
  { n: "Morvan", t: 'c', b: [0.13595, 0.09511, 0.23054, 0.2312], p: [
    { lat: 47.3, lon: 3.95, rayon: 22, hauteur: 700, x: 0.17463, y: 0.19252, r: 0.03868, h: 0.14553 },
    { lat: 47.15, lon: 4.05, rayon: 22, hauteur: 901, x: 0.18826, y: 0.16339, r: 0.03868, h: 0.18732 },
    { lat: 46.98, lon: 4.1, rayon: 20, hauteur: 750, x: 0.19537, y: 0.13028, r: 0.03517, h: 0.15593 }
  ] },
  { n: "Ardennes", t: 'c', b: [0.17824, 0.59299, 0.4087, 0.78378], p: [
    { lat: 50.05, lon: 4.45, rayon: 30, hauteur: 400, x: 0.23099, y: 0.73103, r: 0.05275, h: 0.08316 },
    { lat: 49.9, lon: 4.75, rayon: 30, hauteur: 480, x: 0.26933, y: 0.70245, r: 0.05275, h: 0.09979 },
    { lat: 49.75, lon: 5.15, rayon: 30, hauteur: 500, x: 0.32053, y: 0.67435, r: 0.05275, h: 0.10395 },
    { lat: 49.58, lon: 5.45, rayon: 28, hauteur: 420, x: 0.35947, y: 0.64222, r: 0.04923, h: 0.08732 }
  ] },
  { n: "Argonne-Cotes de Meuse", t: 's', b: [0.25147, 0.40559, 0.43051, 0.6412], p: [
    { lat: 49.35, lon: 4.95, rayon: 26, hauteur: 320, x: 0.29719, y: 0.59548, r: 0.04572, h: 0.06653 },
    { lat: 49.1, lon: 5.25, rayon: 26, hauteur: 380, x: 0.33679, y: 0.54763, r: 0.04572, h: 0.079 },
    { lat: 48.85, lon: 5.55, rayon: 26, hauteur: 400, x: 0.37675, y: 0.49994, r: 0.04572, h: 0.08316 },
    { lat: 48.6, lon: 5.6, rayon: 26, hauteur: 380, x: 0.38479, y: 0.45131, r: 0.04572, h: 0.079 }
  ] },
  { n: "Plateau lorrain-Langres", t: 's', b: [0.24985, 0.17774, 0.53512, 0.55529], p: [
    { lat: 48.8, lon: 6.3, rayon: 35, hauteur: 380, x: 0.47358, y: 0.49375, r: 0.06154, h: 0.079 },
    { lat: 48.4, lon: 5.9, rayon: 35, hauteur: 400, x: 0.42498, y: 0.4136, r: 0.06154, h: 0.08316 },
    { lat: 48, lon: 5.55, rayon: 35, hauteur: 450, x: 0.38212, y: 0.3339, r: 0.06154, h: 0.09356 },
    { lat: 47.75, lon: 5.2, rayon: 35, hauteur: 516, x: 0.33774, y: 0.2837, r: 0.06154, h: 0.10728 },
    { lat: 47.5, lon: 4.95, rayon: 32, hauteur: 500, x: 0.30612, y: 0.23401, r: 0.05627, h: 0.10395 }
  ] },
  { n: "Cote-d'Or-Chatillonnais", t: 's', b: [0.21628, 0.12908, 0.32675, 0.33117], p: [
    { lat: 47.75, lon: 4.65, rayon: 28, hauteur: 500, x: 0.26551, y: 0.28194, r: 0.04923, h: 0.10395 },
    { lat: 47.45, lon: 4.65, rayon: 28, hauteur: 600, x: 0.26674, y: 0.22334, r: 0.04923, h: 0.12474 },
    { lat: 47.2, lon: 4.75, rayon: 26, hauteur: 600, x: 0.28103, y: 0.1748, r: 0.04572, h: 0.12474 }
  ] },
  { n: "Artois-Boulonnais", t: 's', b: [-0.14496, 0.72987, 0.05617, 0.89652], p: [
    { lat: 50.7, lon: 1.75, rayon: 22, hauteur: 180, x: -0.10628, y: 0.85784, r: 0.03868, h: 0.03742 },
    { lat: 50.55, lon: 2.05, rayon: 24, hauteur: 200, x: -0.06942, y: 0.82795, r: 0.0422, h: 0.04158 },
    { lat: 50.4, lon: 2.35, rayon: 24, hauteur: 190, x: -0.03234, y: 0.7982, r: 0.0422, h: 0.0395 },
    { lat: 50.25, lon: 2.75, rayon: 22, hauteur: 170, x: 0.01749, y: 0.76855, r: 0.03868, h: 0.03534 }
  ] },
  { n: "Pays de Bray-Vexin", t: 's', b: [-0.18973, 0.53483, -0.02742, 0.69522], p: [
    { lat: 49.65, lon: 1.45, rayon: 24, hauteur: 220, x: -0.14753, y: 0.65302, r: 0.0422, h: 0.04574 },
    { lat: 49.45, lon: 1.8, rayon: 24, hauteur: 230, x: -0.1038, y: 0.61313, r: 0.0422, h: 0.04782 },
    { lat: 49.25, lon: 2.1, rayon: 22, hauteur: 200, x: -0.0661, y: 0.57351, r: 0.03868, h: 0.04158 }
  ] },
  { n: "Monts d'Arree-Montagnes Noires-Mene", t: 'c', b: [-0.90201, 0.33439, -0.61103, 0.48946], p: [
    { lat: 48.45, lon: -4.1, rayon: 18, hauteur: 300, x: -0.87036, y: 0.45781, r: 0.03165, h: 0.06237 },
    { lat: 48.38, lon: -3.85, rayon: 20, hauteur: 385, x: -0.83926, y: 0.44132, r: 0.03517, h: 0.08004 },
    { lat: 48.25, lon: -3.7, rayon: 20, hauteur: 330, x: -0.82202, y: 0.41434, r: 0.03517, h: 0.06861 },
    { lat: 48.15, lon: -3.5, rayon: 20, hauteur: 320, x: -0.79769, y: 0.39269, r: 0.03517, h: 0.06653 },
    { lat: 48.05, lon: -3.15, rayon: 20, hauteur: 290, x: -0.75372, y: 0.36956, r: 0.03517, h: 0.06029 },
    { lat: 48.2, lon: -2.75, rayon: 20, hauteur: 340, x: -0.69949, y: 0.39486, r: 0.03517, h: 0.07069 },
    { lat: 48.3, lon: -2.35, rayon: 20, hauteur: 320, x: -0.6462, y: 0.4107, r: 0.03517, h: 0.06653 }
  ] },
  { n: "Massif armoricain / socle", t: 's', b: [-0.90494, 0.27762, -0.46325, 0.51969], p: [
    { lat: 48.3, lon: -3.6, rayon: 55, hauteur: 180, x: -0.80823, y: 0.42298, r: 0.09671, h: 0.03742 },
    { lat: 48.2, lon: -2.5, rayon: 55, hauteur: 200, x: -0.66701, y: 0.39254, r: 0.09671, h: 0.04158 },
    { lat: 48.1, lon: -1.6, rayon: 50, hauteur: 150, x: -0.55117, y: 0.36554, r: 0.08792, h: 0.03119 }
  ] },
  { n: "Bocage normand-Perche", t: 'c', b: [-0.50966, 0.36136, -0.16578, 0.56621], p: [
    { lat: 48.95, lon: -1.05, rayon: 22, hauteur: 250, x: -0.47098, y: 0.52753, r: 0.03868, h: 0.05198 },
    { lat: 48.82, lon: -0.45, rayon: 24, hauteur: 365, x: -0.39514, y: 0.49848, r: 0.0422, h: 0.07588 },
    { lat: 48.65, lon: -0.15, rayon: 24, hauteur: 340, x: -0.35789, y: 0.46366, r: 0.0422, h: 0.07069 },
    { lat: 48.48, lon: 0.55, rayon: 24, hauteur: 300, x: -0.26858, y: 0.42725, r: 0.0422, h: 0.06237 },
    { lat: 48.35, lon: 1.05, rayon: 22, hauteur: 250, x: -0.20446, y: 0.40004, r: 0.03868, h: 0.05198 }
  ] },
  { n: "Gatine vendeenne", t: 's', b: [-0.53422, 0.00343, -0.37274, 0.15993], p: [
    { lat: 46.85, lon: -1.05, rayon: 24, hauteur: 220, x: -0.49202, y: 0.11773, r: 0.0422, h: 0.04574 },
    { lat: 46.68, lon: -0.75, rayon: 26, hauteur: 285, x: -0.45357, y: 0.08259, r: 0.04572, h: 0.05925 },
    { lat: 46.5, lon: -0.45, rayon: 24, hauteur: 250, x: -0.41494, y: 0.04563, r: 0.0422, h: 0.05198 }
  ] },
  { n: "Perigord-Limousin", t: 's', b: [-0.30686, -0.33123, -0.10948, -0.08453], p: [
    { lat: 45.55, lon: 0.85, rayon: 35, hauteur: 400, x: -0.24532, y: -0.14607, r: 0.06154, h: 0.08316 },
    { lat: 45.35, lon: 1.1, rayon: 38, hauteur: 500, x: -0.21207, y: -0.18601, r: 0.06682, h: 0.10395 },
    { lat: 45.1, lon: 1.3, rayon: 35, hauteur: 450, x: -0.18566, y: -0.23547, r: 0.06154, h: 0.09356 },
    { lat: 44.9, lon: 1.45, rayon: 32, hauteur: 400, x: -0.16575, y: -0.27496, r: 0.05627, h: 0.08316 }
  ] },
  { n: "Angoumois", t: 's', b: [-0.38625, -0.19674, -0.26094, -0.07101], p: [
    { lat: 45.65, lon: 0.2, rayon: 30, hauteur: 200, x: -0.3335, y: -0.12376, r: 0.05275, h: 0.04158 },
    { lat: 45.55, lon: 0.35, rayon: 30, hauteur: 190, x: -0.31369, y: -0.14399, r: 0.05275, h: 0.0395 }
  ] },
  { n: "Luberon", t: 'c', b: [0.34505, -0.5109, 0.43323, -0.45337], p: [
    { lat: 43.83, lon: 5.3, rayon: 16, hauteur: 1125, x: 0.37318, y: -0.4815, r: 0.02813, h: 0.23389 },
    { lat: 43.8, lon: 5.55, rayon: 14, hauteur: 900, x: 0.40861, y: -0.48628, r: 0.02462, h: 0.18711 }
  ] },
  { n: "Alpilles", t: 'c', b: [0.27041, -0.5137, 0.34516, -0.46834], p: [
    { lat: 43.8, lon: 4.72, rayon: 12, hauteur: 400, x: 0.29151, y: -0.48944, r: 0.0211, h: 0.08316 },
    { lat: 43.78, lon: 4.95, rayon: 12, hauteur: 493, x: 0.32406, y: -0.4926, r: 0.0211, h: 0.10249 }
  ] },
  { n: "Sainte-Victoire-Sainte-Baume", t: 'c', b: [0.37861, -0.60665, 0.49331, -0.51466], p: [
    { lat: 43.53, lon: 5.5, rayon: 14, hauteur: 900, x: 0.40323, y: -0.53928, r: 0.02462, h: 0.18711 },
    { lat: 43.52, lon: 5.68, rayon: 14, hauteur: 1011, x: 0.42881, y: -0.5404, r: 0.02462, h: 0.21019 },
    { lat: 43.35, lon: 5.75, rayon: 16, hauteur: 1148, x: 0.43989, y: -0.57329, r: 0.02813, h: 0.23867 },
    { lat: 43.3, lon: 5.95, rayon: 14, hauteur: 900, x: 0.46869, y: -0.58203, r: 0.02462, h: 0.18711 }
  ] },
  { n: "Maures-Esterel", t: 'c', b: [0.47972, -0.61201, 0.61252, -0.51707], p: [
    { lat: 43.3, lon: 6.25, rayon: 18, hauteur: 780, x: 0.51137, y: -0.58036, r: 0.03165, h: 0.16216 },
    { lat: 43.35, lon: 6.5, rayon: 16, hauteur: 700, x: 0.54649, y: -0.56907, r: 0.02813, h: 0.14553 },
    { lat: 43.48, lon: 6.8, rayon: 14, hauteur: 618, x: 0.5879, y: -0.54169, r: 0.02462, h: 0.12848 }
  ] },
  { n: "Corse / crete", t: 'c', b: [0.87093, -0.90839, 0.98896, -0.60575], p: [
    { lat: 42.92, lon: 9.42, rayon: 12, hauteur: 700, x: 0.96786, y: -0.62685, r: 0.0211, h: 0.14553 },
    { lat: 42.8, lon: 9.35, rayon: 14, hauteur: 1300, x: 0.95974, y: -0.65107, r: 0.02462, h: 0.27027 },
    { lat: 42.62, lon: 9.2, rayon: 17, hauteur: 1700, x: 0.94103, y: -0.68791, r: 0.02989, h: 0.35343 },
    { lat: 42.45, lon: 9.05, rayon: 18, hauteur: 2200, x: 0.92204, y: -0.72277, r: 0.03165, h: 0.45738 },
    { lat: 42.38, lon: 8.92, rayon: 19, hauteur: 2706, x: 0.90434, y: -0.73786, r: 0.03341, h: 0.56258 },
    { lat: 42.28, lon: 9, rayon: 18, hauteur: 2500, x: 0.91736, y: -0.75651, r: 0.03165, h: 0.51975 },
    { lat: 42.22, lon: 9.05, rayon: 18, hauteur: 2622, x: 0.92549, y: -0.76768, r: 0.03165, h: 0.54511 },
    { lat: 42.1, lon: 9.08, rayon: 18, hauteur: 2400, x: 0.93163, y: -0.79078, r: 0.03165, h: 0.49896 },
    { lat: 42.02, lon: 9.1, rayon: 18, hauteur: 2352, x: 0.93574, y: -0.80618, r: 0.03165, h: 0.48898 },
    { lat: 41.9, lon: 9.18, rayon: 18, hauteur: 2134, x: 0.94919, y: -0.82872, r: 0.03165, h: 0.44366 },
    { lat: 41.78, lon: 9.15, rayon: 17, hauteur: 1300, x: 0.94666, y: -0.8525, r: 0.02989, h: 0.27027 },
    { lat: 41.62, lon: 9.15, rayon: 14, hauteur: 700, x: 0.9491, y: -0.88377, r: 0.02462, h: 0.14553 }
  ] },
  { n: "Corse / socle", t: 's', b: [0.86421, -0.9109, 0.98553, -0.62658], p: [
    { lat: 42.7, lon: 9.2, rayon: 26, hauteur: 500, x: 0.93981, y: -0.6723, r: 0.04572, h: 0.10395 },
    { lat: 42.35, lon: 8.98, rayon: 28, hauteur: 700, x: 0.91344, y: -0.74306, r: 0.04923, h: 0.14553 },
    { lat: 42, lon: 9.05, rayon: 28, hauteur: 600, x: 0.92878, y: -0.81065, r: 0.04923, h: 0.12474 },
    { lat: 41.7, lon: 9.1, rayon: 24, hauteur: 400, x: 0.94058, y: -0.8687, r: 0.0422, h: 0.08316 }
  ] }
]
};
RELIEF.anchors = RELIEF.massifs.flatMap(m => m.p);

/** Altitude en unites monde : 0 au plus bas, RELIEF.max au sommet des Alpes.
    Deformation du domaine (les cretes ondulent), grain de versant, murmure des plaines. */
export function sampleRelief(x, y) {
  const M = RELIEF.massifs;
  // 1. domain warp a deux echelles : aucune ligne de crete n'est une capsule parfaite,
  //    aucun contour n'est un cercle — les chaines serpentent et se coudent comme de vraies chaines
  const wx = (vnoise(x * 5.4 + 11.2, y * 5.4 + 3.7) - 0.5) * 0.040 + (vnoise(x * 15.1 + 41.3, y * 15.1 + 8.9) - 0.5) * 0.011;
  const wy = (vnoise(x * 5.4 + 5.1, y * 5.4 + 19.4) - 0.5) * 0.040 + (vnoise(x * 15.1 + 7.7, y * 15.1 + 27.5) - 0.5) * 0.011;
  let h = ridgeField(M, x + wx, y + wy);
  // 2. grain de versant + cretes ridees, proportionnels au relief local.
  //    Frequence volontairement basse : au-dessous de ~20 km, le detail n'existe plus a l'ecran,
  //    et un grain trop fin transforme une crete etroite en chapelet de perles.
  if (h > 0) {
    const g = fbm(x * 9 + 2.5, y * 9 + 7.5, 4);
    const rg = 1 - Math.abs(fbm(x * 16 + 1.1, y * 16 + 4.2, 2) * 2 - 1);
    h *= 0.80 + 0.30 * g + 0.11 * rg;
  }
  // 3. murmure des plaines : une plaine n'est jamais une table (fondu doux vers les massifs)
  const k = h < 0.30 ? (1 - h / 0.30) : 0;
  h += 0.055 * fbm(x * 4.1 + 31.7, y * 4.1 + 13.3, 3) * k * k;
  return h * RELIEF.gain;
}
/** Cuit une carte de hauteur w x h couvrant la bbox monde, marge comprise (~35 ms en 384 x 358,
    ~130 ms en 768). Le moteur a interet a cuire la grille UNE fois puis a l'echantillonner :
    sampleReliefGrid est ~8 x plus rapide que sampleRelief par sommet, pour un ecart < 1.5 % de max. */
export function buildReliefGrid(w = 384, h = Math.round(w * RELIEF.ratio)) {
  const x0 = -1.02, y0 = -RELIEF.ratio - 0.02, x1 = 1.02, y1 = RELIEF.ratio + 0.02;
  const dx = (x1 - x0) / (w - 1), dy = (y1 - y0) / (h - 1), data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = sampleRelief(x0 + i * dx, y0 + j * dy);
  return { w, h, x0, y0, dx, dy, data };
}
/** Meme grille que buildReliefGrid, mais cuite par TRANCHES de lignes : l'appelant reprend la main
    entre deux tranches (`for (const g of buildReliefGridSlices(768)) { grid = g; await yieldFrame(); }`)
    et ne gele jamais le fil principal au moment du scroll. La derniere valeur cedee est la grille
    complete — c'est toujours le MEME objet, rempli au fur et a mesure. */
export function* buildReliefGridSlices(w = 384, h = Math.round(w * RELIEF.ratio), rows = 24) {
  const x0 = -1.02, y0 = -RELIEF.ratio - 0.02, x1 = 1.02, y1 = RELIEF.ratio + 0.02;
  const dx = (x1 - x0) / (w - 1), dy = (y1 - y0) / (h - 1), data = new Float32Array(w * h);
  const g = { w, h, x0, y0, dx, dy, data };
  for (let j0 = 0; j0 < h; j0 += rows) {
    const j1 = Math.min(h, j0 + rows);
    for (let j = j0; j < j1; j++) for (let i = 0; i < w; i++) data[j * w + i] = sampleRelief(x0 + i * dx, y0 + j * dy);
    yield g;
  }
  return g;
}
/** Lecture bilineaire d'une carte issue de buildReliefGrid. */
export function sampleReliefGrid(g, x, y) {
  const u = (x - g.x0) / g.dx, v = (y - g.y0) / g.dy;
  if (u < 0 || v < 0 || u > g.w - 1 || v > g.h - 1) return 0;
  const i = u | 0, j = v | 0, fu = u - i, fv = v - j;
  const i1 = Math.min(i + 1, g.w - 1), j1 = Math.min(j + 1, g.h - 1);
  const t = g.data[j * g.w + i] + (g.data[j * g.w + i1] - g.data[j * g.w + i]) * fu;
  const b = g.data[j1 * g.w + i] + (g.data[j1 * g.w + i1] - g.data[j1 * g.w + i]) * fu;
  return t + (b - t) * fv;
}

export default { project, projectWorld, toWorld, toSvg, BOUNDS, REGIONS, OUTLINE, OUTLINE_SEGMENTS, BORDERS, RELIEF, sampleRelief, buildReliefGrid, buildReliefGridSlices, sampleReliefGrid, regionAt, contains };

/** Trocados pelo `define` do electron-vite, só na seção `main` (processos main e núcleo). */
declare const __GOOGLE_CLIENT_ID__: string;
declare const __GOOGLE_CLIENT_SECRET__: string;

/** Imagens importadas no renderer viram a URL do arquivo no build. */
declare module '*.webp' {
  const src: string;
  export default src;
}

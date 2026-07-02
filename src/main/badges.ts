import { nativeImage, NativeImage } from 'electron'

// Tiny 16×16 taskbar overlay badges drawn as a single filled dot each. They are
// pre-rendered PNGs embedded as base64 so the main process needs no drawing
// dependency and no asset files: green = a run finished successfully, red = a run
// errored, amber = a run is waiting on tool approval. Decoded lazily and cached
// (the raw base64 for each color is generated once at build time — see the script
// in the feature notes; each is an anti-aliased circle on transparent alpha).

const SUCCESS_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYUlEQVR4nGOI2VzHQAnGJ8kOxHpQzE6KASANK4D4PxpeAZXDa0AYFo3oOAyXAXpEaIZhPWwGYHM2LrwC3QB2EjTDMDuyAaQ4H8UbVDOAYi9QHIhUiUaKExJVkjJVMhNJGADiVAZfgV0zCwAAAABJRU5ErkJggg=='
const ERROR_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYUlEQVR4nGN4nJLAQAnGJ8kOxHpQzE6KASANK4D4PxpeAZXDa0AYFo3oOAyXAXpEaIZhPWwGYHM2LrwC3QB2EjTDMDuyAaQ4H8UbVDOAYi9QHIhUiUaKExJVkjJVMhNJGABnfiBfACX3BAAAAABJRU5ErkJggg=='
const APPROVAL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYUlEQVR4nGN4vCKcgRKMT5IdiPWgmJ0UA0AaVgDxfzS8AiqH14AwLBrRcRguA/SI0AzDetgMwOZsXHgFugHsJGiGYXZkA0hxPoo3qGYAxV6gOBCpEo0UJySqJGWqZCaSMABtBltfDwxJaQAAAABJRU5ErkJggg=='

let successIcon: NativeImage | null = null
let errorIcon: NativeImage | null = null
let approvalIcon: NativeImage | null = null

function decode(b64: string): NativeImage {
  return nativeImage.createFromDataURL(`data:image/png;base64,${b64}`)
}

export function successBadge(): NativeImage {
  return (successIcon ??= decode(SUCCESS_PNG))
}
export function errorBadge(): NativeImage {
  return (errorIcon ??= decode(ERROR_PNG))
}
export function approvalBadge(): NativeImage {
  return (approvalIcon ??= decode(APPROVAL_PNG))
}

import path from 'node:path'

import { Uri } from 'vscode'

import { config } from './config'

const presetName = 'islands-dark'

function assetURL(fileName: string): string {
  const filePath = path.resolve(__dirname, '..', 'res', 'presets', presetName, 'fonts', fileName)
  return Uri.file(filePath).toString().replace(/^file:\/\//, 'vscode-file://vscode-app')
}

export function isIslandsDarkPreset() {
  return config.preset === presetName
}

export function getPresetFamilies() {
  if (!isIslandsDarkPreset()) {
    return {}
  }

  return {
    monospace: 'IBM Plex Mono',
    sansSerif: 'Bear Sans UI',
  }
}

export function getPresetCSS() {
  if (!isIslandsDarkPreset()) {
    return ''
  }

  return `
@font-face {
  font-family: 'Bear Sans UI';
  src: url('${assetURL('BearSansUI-Regular.otf')}') format('opentype');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Bear Sans UI Heading';
  src: url('${assetURL('BearSansUIHeading-Bold.otf')}') format('opentype');
  font-style: normal;
  font-weight: 700;
  font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('${assetURL('IBMPlexMono-Regular.ttf')}') format('truetype');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
`
}

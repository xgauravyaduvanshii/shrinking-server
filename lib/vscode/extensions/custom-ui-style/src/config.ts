import { defineConfigObject } from 'reactive-vscode'
import { workspace } from 'vscode'

import * as Meta from './generated/meta'
import { getPresetFamilies } from './preset'

export const config = defineConfigObject<Meta.ScopedConfigKeyTypeMap>(
  Meta.scopedConfigs.scope,
  Meta.scopedConfigs.defaults,
)

export const ffKey = 'editor.fontFamily'

export function getFamilies() {
  const presetFamilies = getPresetFamilies()
  return {
    monospace: config['font.monospace']
      || workspace.getConfiguration().inspect<string>(ffKey)!.globalValue
      || presetFamilies.monospace,
    sansSerif: config['font.sansSerif'] || presetFamilies.sansSerif,
  }
}

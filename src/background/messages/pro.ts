import {
  checkLicense,
  openCheckoutPage,
  activateLicense,
  getStoredLicense,
  clearLicense,
  isProUser,
} from '@/shared/licensing'
import type { MessageResponse, MessageType } from './types'

type ProMessage = Extract<
  MessageType,
  {
    type:
      | 'PRO_CHECK_STATUS'
      | 'PRO_OPEN_CHECKOUT'
      | 'PRO_ACTIVATE_LICENSE'
      | 'PRO_GET_LICENSE'
      | 'PRO_CLEAR_LICENSE'
  }
>

export async function handleProMessage(message: ProMessage): Promise<MessageResponse> {
  switch (message.type) {
    case 'PRO_CHECK_STATUS': {
      const isPro = await isProUser()
      const { email } = isPro ? await checkLicense() : { email: undefined }
      return { success: true, data: { isPro, email } }
    }

    case 'PRO_OPEN_CHECKOUT': {
      openCheckoutPage()
      return { success: true }
    }

    case 'PRO_ACTIVATE_LICENSE': {
      const license = await activateLicense(message.licenseKey)
      if (license && license.status === 'active') {
        return { success: true, data: { license } }
      }
      return { success: false, error: 'Invalid or inactive license key' }
    }

    case 'PRO_GET_LICENSE': {
      const license = await getStoredLicense()
      return { success: true, data: { license } }
    }

    case 'PRO_CLEAR_LICENSE': {
      await clearLicense()
      return { success: true }
    }
  }
}

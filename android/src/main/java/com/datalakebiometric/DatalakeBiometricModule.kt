package com.datalakebiometric

import com.facebook.react.bridge.ReactApplicationContext

class DatalakeBiometricModule(reactContext: ReactApplicationContext) :
  NativeDatalakeBiometricSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeDatalakeBiometricSpec.NAME
  }
}

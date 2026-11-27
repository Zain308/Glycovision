package com.glycovision.steprecorder

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.LocalRecordingClient
import com.google.android.gms.fitness.data.LocalDataType
import com.google.android.gms.fitness.data.LocalField
import com.google.android.gms.fitness.request.LocalDataReadRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.TimeUnit

/**
 * All-day step counting by Google Play services (Recording API). It keeps
 * counting while the app is closed and after a restart, needs no Google
 * account, and keeps 10 days on the phone.
 */
class StepRecorderModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun client(): LocalRecordingClient = FitnessLocal.getLocalRecordingClient(context)

  override fun definition() = ModuleDefinition {
    Name("StepRecorder")

    Function("isAvailable") {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(
        context,
        LocalRecordingClient.LOCAL_RECORDING_CLIENT_MIN_VERSION_CODE
      ) == ConnectionResult.SUCCESS
    }

    // Does nothing if it is already counting.
    AsyncFunction("start") { promise: Promise ->
      client().subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { e -> promise.reject("ERR_STEP_RECORDER", e.message ?: "Could not start", e) }
    }

    AsyncFunction("stop") { promise: Promise ->
      client().unsubscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { e -> promise.reject("ERR_STEP_RECORDER", e.message ?: "Could not stop", e) }
    }

    // [start, end, steps, start, end, steps, ...] in milliseconds.
    AsyncFunction("read") { startMs: Double, endMs: Double, promise: Promise ->
      val request = LocalDataReadRequest.Builder()
        .read(LocalDataType.TYPE_STEP_COUNT_DELTA)
        .setTimeRange(startMs.toLong(), endMs.toLong(), TimeUnit.MILLISECONDS)
        .build()
      client().readData(request)
        .addOnSuccessListener { response ->
          val out = ArrayList<Double>()
          for (point in response.getDataSet(LocalDataType.TYPE_STEP_COUNT_DELTA).dataPoints) {
            out.add(point.getStartTime(TimeUnit.MILLISECONDS).toDouble())
            out.add(point.getEndTime(TimeUnit.MILLISECONDS).toDouble())
            out.add(point.getValue(LocalField.FIELD_STEPS).asInt().toDouble())
          }
          promise.resolve(out)
        }
        .addOnFailureListener { e -> promise.reject("ERR_STEP_RECORDER", e.message ?: "Could not read steps", e) }
    }
  }
}

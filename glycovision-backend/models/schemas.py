import re
from datetime import date, datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


# Upper limits that catch typos (6000 g instead of 60 g) instead of
# silently capping them. A single meal above 500 g of carbohydrate is not
# realistic; insulin on board above 50 u is more than the largest dose the
# app accepts (BolusLogRequest.dose_units <= 50).
MAX_MEAL_CARBS_G = 500
MAX_IOB_UNITS = 50


# ---------------------------------------------------------
# NUTRITION / FOOD SCANNER
# ---------------------------------------------------------

class NutrientInfo(BaseModel):
    name: str

    carbs: float = Field(ge=0)
    protein: float = Field(ge=0)
    fat: float = Field(ge=0)
    calories: float = Field(ge=0)

    fiber: float = Field(default=0.0, ge=0)

    volume: str = "Standard portion"

    # Weight in grams that the nutrient values above describe. The app
    # scales them to the quantity the user picks.
    basis_grams: float = Field(default=100.0, gt=0)

    # Where the values come from (food composition table and entry), and
    # how close that entry is to the dish: exact, close or composite.
    source: str = ""
    match: str = ""


class DetectedItem(BaseModel):
    food_name: str

    estimated_volume: str

    # None when nutrition could not be found for the recognised dish.
    nutrients: Optional[NutrientInfo] = None

    # No default: a missing confidence must not be shown as 90%.
    confidence: float = Field(
        ge=0.0,
        le=1.0,
    )


class MealSummary(BaseModel):
    total_estimated_carbs: float = Field(ge=0)
    total_protein: float = Field(ge=0)
    total_fat: float = Field(ge=0)
    total_calories: float = Field(ge=0)


class MealAnalysisResponse(BaseModel):
    status: str

    summary: MealSummary

    ai_found: List[DetectedItem]

    suggested_bolus: Optional[float] = None


# ---------------------------------------------------------
# REQUEST MODELS
# ---------------------------------------------------------

class Entry(BaseModel):
    """Something logged on the phone, maybe without internet (services/entries.py)."""
    client_id: Optional[UUID] = None
    # Set only when an entry is sent again or later.
    age_seconds: Optional[float] = Field(default=None, ge=0, le=30 * 24 * 3600)


class BgLogRequest(Entry):
    value: float = Field(
        ...,
        gt=20,
        lt=600,
        description="Blood glucose value in mg/dL",
    )


class MealLogRequest(Entry):
    food_name: str = Field(
        ...,
        min_length=1,
        max_length=200,
    )

    carbs: float = Field(
        ...,
        ge=0,
        le=MAX_MEAL_CARBS_G,
    )

    protein: float = Field(
        default=0.0,
        ge=0,
        le=MAX_MEAL_CARBS_G,
    )

    fat: float = Field(
        default=0.0,
        ge=0,
        le=MAX_MEAL_CARBS_G,
    )

    calories: float = Field(
        default=0.0,
        ge=0,
        le=10000,
    )


class BolusLogRequest(Entry):
    dose_units: float = Field(
        ...,
        ge=0,
        le=50,
    )

    carbs: Optional[float] = Field(
        default=None,
        ge=0,
        le=MAX_MEAL_CARBS_G,
    )

    current_bg: Optional[float] = Field(
        default=None,
        gt=20,
        lt=600,
    )


class ProfileUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=120,
    )

    diabetes_type: Optional[str] = None

    icr: Optional[float] = Field(
        default=None,
        gt=1,
        lt=50,
    )

    isf: Optional[float] = Field(
        default=None,
        gt=5,
        lt=150,
    )

    target_bg: Optional[float] = Field(
        default=None,
        gt=70,
        lt=180,
    )

    # Must match services.iob_engine MIN/MAX_DIA_HOURS.
    dia_hours: Optional[float] = Field(
        default=None,
        ge=3,
        le=8,
    )

    # Body details (BMI, BMR) and insulin use.
    sex: Optional[Literal["male", "female"]] = None
    birth_year: Optional[int] = Field(default=None, ge=1900, le=2100)
    height_cm: Optional[float] = Field(default=None, ge=80, le=250)
    weight_kg: Optional[float] = Field(default=None, ge=15, le=350)
    mealtime_insulin: Optional[bool] = None
    insulin_type: Optional[Literal["rapid", "regular", "premixed", "other"]] = None
    disclaimer_accepted_at: Optional[datetime] = None

    # Fitness goals: steps a day, Heart Points a week.
    step_goal: Optional[int] = Field(default=None, ge=1000, le=40000)
    heart_goal: Optional[int] = Field(default=None, ge=30, le=600)


# ---------------------------------------------------------
# HEALTH DATA (Health Connect) AND MANUAL ACTIVITY
# ---------------------------------------------------------

class HealthSample(BaseModel):
    kind: Literal["steps", "heart_rate", "active_kcal", "distance_m", "move_min", "heart_pts"]
    time: datetime
    value: float = Field(..., ge=0, le=20000)


class HealthSession(BaseModel):
    kind: Literal["sleep", "exercise"]
    start: datetime
    end: datetime
    title: Optional[str] = Field(default=None, max_length=60)
    deep_min: Optional[int] = Field(default=None, ge=0, le=1440)
    rem_min: Optional[int] = Field(default=None, ge=0, le=1440)
    awake_min: Optional[int] = Field(default=None, ge=0, le=1440)


class HealthDayTotal(BaseModel):
    day: date
    steps: Optional[float] = Field(default=None, ge=0, le=200000)
    distance_m: Optional[float] = Field(default=None, ge=0, le=300000)
    active_kcal: Optional[float] = Field(default=None, ge=0, le=20000)


VITAL_LIMITS = {"weight": (15, 350), "blood_pressure": (50, 300), "hba1c": (3, 20), "sleep": (0.5, 24)}


class VitalRequest(BaseModel):
    """weight kg · blood_pressure mmHg (value/value2) · hba1c % · sleep hours"""
    kind: Literal["weight", "blood_pressure", "hba1c", "sleep"]
    value: float
    value2: Optional[float] = None

    @model_validator(mode="after")
    def _in_range(self):
        low, high = VITAL_LIMITS[self.kind]
        if not low <= self.value <= high:
            raise ValueError(f"{self.kind} must be between {low} and {high}")
        if self.kind == "blood_pressure":
            if self.value2 is None or not 30 <= self.value2 <= 200 or self.value2 >= self.value:
                raise ValueError("the lower number must be between 30 and 200 and below the upper one")
        else:
            self.value2 = None
        return self


class VitalLogRequest(VitalRequest, Entry):
    pass


class HealthVital(VitalRequest):
    time: datetime


class HealthGlucose(BaseModel):
    time: datetime
    value: float = Field(..., ge=20, le=600)      # mg/dL


class HealthSyncRequest(BaseModel):
    glucose: List[HealthGlucose] = Field(default_factory=list, max_length=2000)
    samples: List[HealthSample] = Field(default_factory=list, max_length=3000)
    sessions: List[HealthSession] = Field(default_factory=list, max_length=300)
    days: List[HealthDayTotal] = Field(default_factory=list, max_length=40)
    vitals: List[HealthVital] = Field(default_factory=list, max_length=300)


class ActivityLogRequest(Entry):
    activity: str = Field(..., min_length=1, max_length=60)
    minutes: int = Field(..., ge=1, le=600)
    # From a live workout.
    steps: Optional[int] = Field(default=None, ge=0, le=100000)
    distance_m: Optional[float] = Field(default=None, ge=0, le=200000)
    kcal: Optional[float] = Field(default=None, ge=0, le=10000)


# ---------------------------------------------------------
# MEDICINES AND ACCOUNT
# ---------------------------------------------------------

class MedicineRequest(BaseModel):
    """Typed in from the patient's prescription."""
    name: str = Field(..., min_length=1, max_length=80)
    dose: Optional[str] = Field(default=None, max_length=60)
    times: List[str] = Field(default_factory=list, max_length=8)
    note: Optional[str] = Field(default=None, max_length=200)

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        if not v.strip():
            raise ValueError("name is empty")
        return v.strip()

    @field_validator("times")
    @classmethod
    def _times(cls, v):
        for t in v:
            if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t):
                raise ValueError("times must look like 08:00")
        return sorted(set(v))


class MedicineLogRequest(BaseModel):
    day: date
    time: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    status: Optional[Literal["taken", "skipped"]] = None     # None = undo


class DeleteAccountRequest(BaseModel):
    confirm: Literal["DELETE"]


# ---------------------------------------------------------
# BOLUS / INTERVENTION
# ---------------------------------------------------------

class PatientState(BaseModel):
    current_bg: float = Field(
        ...,
        gt=20,
        lt=600,
    )

    target_bg: float = Field(
        default=110,
        gt=70,
        lt=180,
    )

    isf: float = Field(
        ...,
        gt=5,
        lt=150,
    )

    iob: float = Field(
        default=0.0,
        ge=0,
        le=MAX_IOB_UNITS,
    )

    total_carbs: float = Field(
        ...,
        ge=0,
        le=MAX_MEAL_CARBS_G,
    )

    icr: float = Field(
        ...,
        gt=1,
        lt=50,
    )


class BolusBreakdown(BaseModel):
    carb_dose_units: float
    correction_dose_units: float
    iob_subtracted: float


class BolusResponse(BaseModel):
    status: str

    recommended_total_dose_units: float

    breakdown: BolusBreakdown

    strategy: str

    disclaimer: str

    safety_flags: List[str] = Field(
        default_factory=list
    )

    # Stress context from a recent voice check (services.stress_context).
    # It adds advice around the estimate; it never changes the dose.
    stress_context: Optional[dict] = None

    # The dose played forward on the insulin curve (services.dose_simulator).
    dose_test: Optional[dict] = None

    # Temporary backward compatibility
    stress_score: Optional[float] = None

    stress_adjusted: bool = False


# ---------------------------------------------------------
# VOICE / ACOUSTIC ANALYSIS
# ---------------------------------------------------------

class StressRequest(BaseModel):
    duration_seconds: float = Field(
        default=5.0,
        ge=3.0,
        le=15.0,
    )


class StressResponse(BaseModel):
    # Kept temporarily for compatibility
    stress_score: float = Field(
        ge=0.0,
        le=1.0,
    )

    acoustic_score: float = Field(
        ge=0.0,
        le=1.0,
    )

    quality: str

    f0_mean: float

    f0_std: float

    jitter: float = Field(
        ge=0.0,
    )

    shimmer: float = Field(
        ge=0.0,
    )

    hnr: float

    voiced_ratio: float = Field(
        ge=0.0,
        le=1.0,
    )

    interpretation: str

    model_status: str

    disclaimer: str

class SpikePredictionRequest(BaseModel):

    current_bg: float = Field(
        ...,
        gt=20,
        lt=600,
    )

    bg_15m_ago: Optional[float] = Field(
        default=None,
        gt=20,
        lt=600,
    )

    bg_30m_ago: Optional[float] = Field(
        default=None,
        gt=20,
        lt=600,
    )

    bg_60m_ago: Optional[float] = Field(
        default=None,
        gt=20,
        lt=600,
    )

    carbs: float = Field(
        default=0,
        ge=0,
        le=MAX_MEAL_CARBS_G,
    )

    protein: float = Field(
        default=0,
        ge=0,
    )

    fat: float = Field(
        default=0,
        ge=0,
    )

    iob: float = Field(
        default=0,
        ge=0,
        le=MAX_IOB_UNITS,
    )

    recent_bolus: float = Field(
        default=0,
        ge=0,
    )

    icr: float = Field(
        ...,
        gt=1,
        lt=50,
    )

    isf: float = Field(
        ...,
        gt=5,
        lt=150,
    )

    acoustic_score: Optional[float] = Field(
        default=None,
        ge=0,
        le=1,
    )


class SpikePredictionResponse(BaseModel):

    predicted_bg_30m: float

    predicted_bg_60m: float

    predicted_bg_90m: float

    predicted_bg_120m: float

    expected_peak_bg: float

    expected_peak_minutes: int

    spike_probability: float = Field(
        ge=0,
        le=1,
    )

    risk_level: str

    model_version: str

    disclaimer: str

class SpikeFeatureRequest(BaseModel):

    glucose_t_minus_60: float
    glucose_t_minus_55: float
    glucose_t_minus_50: float
    glucose_t_minus_45: float
    glucose_t_minus_40: float
    glucose_t_minus_35: float
    glucose_t_minus_30: float
    glucose_t_minus_25: float
    glucose_t_minus_20: float
    glucose_t_minus_15: float
    glucose_t_minus_10: float
    glucose_t_minus_5: float

    current_bg: float

    bg_change_15m: float
    bg_change_30m: float
    bg_change_60m: float

    bg_mean_60m: float
    bg_std_60m: float
    bg_min_60m: float
    bg_max_60m: float

    carbs_60m: float
    bolus_60m: float
    basal_mean_60m: float

    heart_rate_mean_60m: float
    steps_60m: float
    calories_60m: float

    hour_sin: float
    hour_cos: float
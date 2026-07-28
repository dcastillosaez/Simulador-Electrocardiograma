from ecg_api.errors import (
    EngineFailureError,
    InvalidParamsError,
    RhythmNotFoundError,
    SimulationError,
)


def test_each_error_carries_the_documented_code():
    assert RhythmNotFoundError("x").code == "NOT_FOUND"
    assert InvalidParamsError("x").code == "INVALID_PARAMS"
    assert EngineFailureError("x").code == "ENGINE_FAILURE"


def test_all_domain_errors_derive_from_simulation_error():
    assert issubclass(RhythmNotFoundError, SimulationError)
    assert issubclass(InvalidParamsError, SimulationError)
    assert issubclass(EngineFailureError, SimulationError)

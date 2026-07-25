import ecg_engine


def test_package_exposes_version():
    assert isinstance(ecg_engine.__version__, str)
    assert ecg_engine.__version__.count(".") == 2

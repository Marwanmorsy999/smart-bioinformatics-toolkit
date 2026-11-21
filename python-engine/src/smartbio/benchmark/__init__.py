"""Benchmark tools: query generation and evaluation against known truth."""

from smartbio.benchmark.evaluate import evaluate_benchmark, parse_truth_text
from smartbio.benchmark.queries import make_benchmark_queries

__all__ = ["evaluate_benchmark", "parse_truth_text", "make_benchmark_queries"]

"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";
import { fetchCallReadOnlyFunction, cvToJSON, uintCV, principalCV } from "@stacks/transactions";
import { STACKS_MAINNET } from "@stacks/network";
import { CONTRACT_ADDRESS, CONTRACT_NAME } from "@/config";

interface LeaderboardUser {
  address: string;
  propsReceived: number;
  propsGiven: number;
  rank: number;
}

export default function LeaderboardPage() {
  const [topUsers, setTopUsers] = useState<LeaderboardUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadLeaderboard();
  }, []);

  // Helper for delayed fetch with retries
  const robustFetch = async (fn: () => Promise<any>, retries = 3, delayMs = 500) => {
    for (let i = 0; i < retries; i++) {
      try {
        // Add delay before request to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        console.warn(`Fetch failed, retrying (${i + 1}/${retries})...`);
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, i)));
      }
    }
  };

  const loadLeaderboard = async () => {
    try {
      const network = { ...STACKS_MAINNET, fetchFn: fetch };
      
      // Get current props ID counter
      const counterResult = await robustFetch(() => fetchCallReadOnlyFunction({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-current-props-id",
        functionArgs: [],
        network,
        senderAddress: CONTRACT_ADDRESS,
      }));

      const counterJSON = cvToJSON(counterResult);
      const totalProps = counterJSON.value ? parseInt(counterJSON.value.value) : 0;

      if (totalProps === 0) {
        setIsLoading(false);
        return;
      }

      // Fetch recent props (reduced limit to 10 for stability)
      const limit = Math.min(10, totalProps);
      const startIndex = Math.max(0, totalProps - limit);
      const uniqueUsers = new Set<string>();

      // Fetch props sequentially with robust fetch
      for (let i = startIndex; i < totalProps; i++) {
        try {
          const propsResult = await robustFetch(() => fetchCallReadOnlyFunction({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "get-props-by-id",
            functionArgs: [uintCV(i)],
            network,
            senderAddress: CONTRACT_ADDRESS,
          }));

          const propsJSON = cvToJSON(propsResult);
          // Helper to safely extract tuple data regardless of nesting
          const propData = propsJSON.value?.value?.value || propsJSON.value?.value;
          
          if (propData && propData.giver && propData.receiver) {
            uniqueUsers.add(propData.giver.value);
            uniqueUsers.add(propData.receiver.value);
          }
        } catch (error) {
          console.error(`Error fetching props ${i}:`, error);
        }
      }

      if (uniqueUsers.size === 0) {
        setIsLoading(false);
        return;
      }

      // Fetch stats for each unique user
      const userStats: Array<{
        address: string;
        propsReceived: number;
        propsGiven: number;
      }> = [];

      for (const address of Array.from(uniqueUsers)) {
        try {
          const statsResult = await robustFetch(() => fetchCallReadOnlyFunction({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "get-user-stats",
            functionArgs: [principalCV(address)],
            network,
            senderAddress: address,
          }));

          const statsJSON = cvToJSON(statsResult);
          if (statsJSON.value?.value) {
            userStats.push({
              address,
              propsReceived: parseInt(statsJSON.value.value['props-received'].value),
              propsGiven: parseInt(statsJSON.value.value['props-given'].value),
            });
          }
        } catch (error) {
          console.error(`Error fetching stats for ${address}:`, error);
        }
      }

      // Sort by props received (descending)
      const sorted = userStats.sort((a, b) => b.propsReceived - a.propsReceived);

      // Add rank and convert to LeaderboardUser
      const leaderboard: LeaderboardUser[] = sorted.map((user, index) => ({
        ...user,
        rank: index + 1,
      }));

      setTopUsers(leaderboard);
    } catch (error) {
      console.error("Error loading leaderboard:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1 className={styles.title}>🏆 Leaderboard</h1>
            <p className={styles.subtitle}>Loading leaderboard data from blockchain...</p>
          </div>
        </div>
      </div>
    );
  }

  if (topUsers.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1 className={styles.title}>🏆 Leaderboard</h1>
            <p className={styles.subtitle}>No props have been given yet. Be the first!</p>
          </div>
        </div>
      </div>
    );
  }

  const top3 = topUsers.slice(0, 3);
  const remaining = topUsers.slice(3);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>🏆 Leaderboard</h1>
          <p className={styles.subtitle}>
            Top contributors ranked by props received. Keep giving props to climb the ranks!
          </p>
        </div>

        {/* Top 3 Podium */}
        {top3.length > 0 && (
          <div className={styles.podium}>
            {top3.map((user) => (
              <div key={user.rank} className={styles.podiumCard}>
                <div className={styles.rank}>
                  {user.rank === 1 ? "🥇" : user.rank === 2 ? "🥈" : "🥉"}
                </div>
                <div className={styles.address}>
                  {user.address.slice(0, 8)}...{user.address.slice(-6)}
                </div>
                <div className={styles.propsCount}>{user.propsReceived}</div>
                <div className={styles.propsLabel}>Props Received</div>
                <div className={styles.listStats}>
                  <span>Given: {user.propsGiven}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Remaining Users */}
        {remaining.length > 0 && (
          <div className={styles.list}>
            {remaining.map((user) => (
              <div key={user.rank} className={styles.listItem}>
                <div className={styles.listRank}>#{user.rank}</div>
                <div className={styles.listInfo}>
                  <div className={styles.listAddress}>
                    {user.address.slice(0, 12)}...{user.address.slice(-8)}
                  </div>
                  <div className={styles.listStats}>
                    <span>Received: {user.propsReceived}</span>
                    <span>•</span>
                    <span>Given: {user.propsGiven}</span>
                  </div>
                </div>
                <div className={styles.listPropsCount}>{user.propsReceived}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
